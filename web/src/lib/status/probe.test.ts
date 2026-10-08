import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import net from "node:net";
import { test } from "node:test";
import { classifyError, probeTcp } from "./probe";

/** Socket factice : n'émet que ce que le test lui demande, compte ses fermetures. */
class FakeSocket extends EventEmitter {
  destroyed = 0;
  destroy() {
    this.destroyed++;
  }
}

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)));
}

const close = (server: net.Server) => new Promise((resolve) => server.close(resolve));

test("serveur accessible : connexion acceptée, latence mesurée, connexion refermée", async () => {
  const server = net.createServer();
  const closed = new Promise<void>((resolve) => {
    server.once("connection", (socket) => {
      socket.on("error", () => {});
      socket.once("close", () => resolve());
    });
  });
  const port = await listen(server);
  try {
    const result = await probeTcp({ host: "127.0.0.1", port }, { timeoutMs: 5_000 });

    assert.equal(result.outcome, "connected");
    assert.equal(result.error, null);
    assert.ok(result.latencyMs !== null && result.latencyMs >= 0 && result.latencyMs < 5_000);
    // La sonde referme elle-même : le serveur voit la connexion se terminer.
    await closed;
  } finally {
    await close(server);
  }
});

test("connexion refusée : panne confirmée par le serveur visé", async () => {
  // Port qui vient d'être libéré : plus rien n'y écoute.
  const server = net.createServer();
  const port = await listen(server);
  await close(server);

  // Windows réessaie environ deux secondes avant de rendre le refus.
  const result = await probeTcp({ host: "127.0.0.1", port }, { timeoutMs: 8_000 });

  assert.deepEqual(result, { outcome: "refused", latencyMs: null, error: "ECONNREFUSED" });
});

test("timeout : sans réponse dans le délai, la socket est détruite", async () => {
  const socket = new FakeSocket();
  const started = performance.now();

  const result = await probeTcp({ host: "192.0.2.1", port: 3724 }, { timeoutMs: 40, connect: () => socket });

  assert.deepEqual(result, { outcome: "timeout", latencyMs: null, error: null });
  assert.ok(performance.now() - started >= 35);
  assert.equal(socket.destroyed, 1);
  // Une erreur tardive de la socket détruite ne doit rien lever.
  socket.emit("error", Object.assign(new Error("late"), { code: "ECONNRESET" }));
});

test("erreur DNS : le serveur n'a pas été joint", async () => {
  const lookup = ((_hostname: string, _options: unknown, callback: (error: Error | null, address: string, family: number) => void) => {
    callback(Object.assign(new Error("getaddrinfo ENOTFOUND introuvable.example.test"), { code: "ENOTFOUND" }), "", 4);
  }) as unknown as net.LookupFunction;

  const result = await probeTcp(
    { host: "introuvable.example.test", port: 1119 },
    { timeoutMs: 5_000, connect: (target) => net.connect({ host: target.host, port: target.port, lookup }) },
  );

  // Seul le code est gardé : le message contient le nom visé.
  assert.deepEqual(result, { outcome: "dns", latencyMs: null, error: "ENOTFOUND" });
});

test("la résolution du nom n'est pas comptée dans la latence", async () => {
  const socket = new FakeSocket();
  let time = 1_000;
  const pending = probeTcp({ host: "login.example.test", port: 1119 }, { timeoutMs: 5_000, connect: () => socket, clock: () => time });

  time = 1_250;
  socket.emit("lookup");
  time = 1_282;
  socket.emit("connect");

  assert.deepEqual(await pending, { outcome: "connected", latencyMs: 32, error: null });
  assert.equal(socket.destroyed, 1);
});

test("un premier résultat est définitif", async () => {
  const socket = new FakeSocket();
  const pending = probeTcp({ host: "192.0.2.1", port: 3724 }, { timeoutMs: 5_000, connect: () => socket });

  socket.emit("error", Object.assign(new Error("refused"), { code: "ECONNREFUSED" }));
  socket.emit("connect");

  assert.equal((await pending).outcome, "refused");
  assert.equal(socket.destroyed, 1);
});

test("interruption : la sonde s'arrête sans attendre le délai", async () => {
  const socket = new FakeSocket();
  const controller = new AbortController();
  const pending = probeTcp({ host: "192.0.2.1", port: 3724 }, { timeoutMs: 60_000, connect: () => socket, signal: controller.signal });

  controller.abort();

  assert.deepEqual(await pending, { outcome: "error", latencyMs: null, error: "ABORTED" });
  assert.equal(socket.destroyed, 1);

  // Déjà interrompue avant de commencer : aucune connexion n'est ouverte.
  let opened = 0;
  const skipped = await probeTcp({ host: "192.0.2.1", port: 3724 }, { timeoutMs: 60_000, signal: controller.signal, connect: () => (opened++, socket) });
  assert.equal(skipped.error, "ABORTED");
  assert.equal(opened, 0);
});

test("une connexion impossible à ouvrir est une erreur, pas une exception", async () => {
  const result = await probeTcp(
    { host: "192.0.2.1", port: 3724 },
    {
      timeoutMs: 5_000,
      connect: () => {
        throw Object.assign(new Error("bad port"), { code: "ERR_SOCKET_BAD_PORT" });
      },
    },
  );

  assert.deepEqual(result, { outcome: "error", latencyMs: null, error: "ERR_SOCKET_BAD_PORT" });
});

test("les erreurs sont classées par code", () => {
  const outcome = (code: string | undefined) => classifyError(Object.assign(new Error("x"), { code })).outcome;

  assert.equal(outcome("ECONNREFUSED"), "refused");
  assert.equal(outcome("ETIMEDOUT"), "timeout");
  assert.equal(outcome("EAI_AGAIN"), "dns");
  assert.equal(outcome("ENETUNREACH"), "network");
  assert.equal(outcome("EHOSTUNREACH"), "network");
  assert.equal(outcome("EPIPE"), "error");
  assert.deepEqual(classifyError(new Error("sans code")), { outcome: "error", latencyMs: null, error: "UNKNOWN" });
  // Plusieurs adresses essayées : le code est celui de la première tentative.
  assert.equal(classifyError(new AggregateError([Object.assign(new Error("x"), { code: "ECONNREFUSED" })])).outcome, "refused");
  // Un code qui n'en est pas un n'est pas recopié.
  assert.equal(classifyError({ code: "192.0.2.1:3724 unreachable" }).error, "UNKNOWN");
});
