const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = process.env.PORT || 3000;

// Initialize Next.js
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    // DO NOT let Next.js handle Socket.IO requests, they will conflict!
    if (req.url.startsWith('/socket.io')) {
      return;
    }
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Handle Next.js Hot Module Replacement (HMR) WebSockets
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/_next/')) {
      app.getUpgradeHandler()(req, socket, head);
    }
  });

  const io = new Server(httpServer, {
    cors: {
      origin: '*',
    },
  });

  io.on('connection', (socket) => {
    console.log('A client connected:', socket.id);

    socket.on('join-room', (roomId) => {
      socket.join(roomId);
      console.log(`Socket ${socket.id} joined room ${roomId}`);
      // Notify others in the room
      socket.to(roomId).emit('user-joined', socket.id);
    });

    socket.on('offer', (data) => {
      // data: { roomId, offer }
      console.log('Broadcasting offer to room:', data.roomId);
      socket.to(data.roomId).emit('offer', data.offer);
    });

    socket.on('answer', (data) => {
      // data: { roomId, answer }
      console.log('Broadcasting answer to room:', data.roomId);
      socket.to(data.roomId).emit('answer', data.answer);
    });

    socket.on('ice-candidate', (data) => {
      // data: { roomId, candidate }
      socket.to(data.roomId).emit('ice-candidate', data.candidate);
    });

    socket.on('end-call', (roomId) => {
      socket.to(roomId).emit('end-call');
    });

    socket.on('disconnect', () => {
      console.log('A client disconnected:', socket.id);
    });
  });

  httpServer
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
});
