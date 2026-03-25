jest.mock("../match", () => ({
  findById: jest.fn(),
}));

jest.mock("../message", () => ({
  sendMessage: jest.fn(),
  updateMany: jest.fn(),
}));

const Match = require("../match");
const Message = require("../message");
const { registerRealtimeHandlers } = require("../index");

const createIoHarness = () => {
  const middlewares = [];
  let connectionHandler = null;

  return {
    use: (fn) => middlewares.push(fn),
    on: (event, fn) => {
      if (event === "connection") {
        connectionHandler = fn;
      }
    },
    to: jest.fn(() => ({ emit: jest.fn() })),
    _middlewares: middlewares,
    _connect: (socket) => {
      if (!connectionHandler) {
        throw new Error("Connection handler was not registered");
      }
      connectionHandler(socket);
    },
  };
};

const createSocketHarness = (userId) => {
  const handlers = {};
  const roomEmitter = { emit: jest.fn() };

  return {
    userId,
    handshake: { auth: {}, headers: {} },
    on: jest.fn((event, handler) => {
      handlers[event] = handler;
    }),
    to: jest.fn(() => roomEmitter),
    join: jest.fn(),
    leave: jest.fn(),
    _handlers: handlers,
    _roomEmitter: roomEmitter,
  };
};

describe("Messaging socket integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("emits typing events only for match participants", async () => {
    const io = createIoHarness();
    registerRealtimeHandlers(io);

    const socket = createSocketHarness("user-1");
    io._connect(socket);

    Match.findById.mockResolvedValue({
      farmer_id: { toString: () => "user-1" },
      vendor_id: { toString: () => "user-2" },
      status: "connected",
    });

    await socket._handlers["typing:start"]({ matchId: "match-1" });
    await socket._handlers["typing:stop"]({ matchId: "match-1" });

    expect(socket.to).toHaveBeenCalledWith("match:match-1");
    expect(socket._roomEmitter.emit).toHaveBeenCalledWith("typing:start", {
      matchId: "match-1",
      userId: "user-1",
    });
    expect(socket._roomEmitter.emit).toHaveBeenCalledWith("typing:stop", {
      matchId: "match-1",
      userId: "user-1",
    });
  });

  it("does not emit typing events for non-participants", async () => {
    const io = createIoHarness();
    registerRealtimeHandlers(io);

    const socket = createSocketHarness("user-9");
    io._connect(socket);

    Match.findById.mockResolvedValue({
      farmer_id: { toString: () => "user-1" },
      vendor_id: { toString: () => "user-2" },
      status: "connected",
    });

    await socket._handlers["typing:start"]({ matchId: "match-1" });

    expect(socket.to).not.toHaveBeenCalled();
    expect(socket._roomEmitter.emit).not.toHaveBeenCalled();
  });

  it("marks messages as read and broadcasts read receipts for participants", async () => {
    const ioRoomEmitter = { emit: jest.fn() };
    const io = createIoHarness();
    io.to = jest.fn(() => ioRoomEmitter);
    registerRealtimeHandlers(io);

    const socket = createSocketHarness("user-2");
    io._connect(socket);

    Match.findById.mockResolvedValue({
      farmer_id: { toString: () => "user-1" },
      vendor_id: { toString: () => "user-2" },
      status: "connected",
    });
    Message.updateMany.mockResolvedValue({ modifiedCount: 2 });

    await socket._handlers["mark-read"]({ matchId: "match-1" });

    expect(Message.updateMany).toHaveBeenCalledWith(
      {
        match_id: "match-1",
        recipient_id: "user-2",
        status: "sent",
      },
      {
        status: "read",
      }
    );
    expect(io.to).toHaveBeenCalledWith("match:match-1");
    expect(ioRoomEmitter.emit).toHaveBeenCalledWith(
      "messages-read",
      expect.objectContaining({
        matchId: "match-1",
        readerId: "user-2",
      })
    );
  });
});
