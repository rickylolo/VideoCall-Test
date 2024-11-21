const io = require('socket.io')(8080, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const rooms = {}; // Ahora guardamos información más detallada sobre las salas

io.on('connection', (socket) => {
  console.log('Nuevo usuario conectado:', socket.id);

  socket.on('join-room', (roomId, userId) => {
    socket.join(roomId);
    console.log(`${userId} se unió a la sala: ${roomId}`);

    // Si la sala no existe, la creamos
    if (!rooms[roomId]) {
      rooms[roomId] = {
        users: [],
        host: userId, // El primer usuario que se une es el anfitrión
      };
    }

    // Añadir el usuario a la lista de la sala
    rooms[roomId].users.push(userId);

    // Notificar a los demás usuarios que un nuevo usuario se ha unido
    socket.to(roomId).emit('user-connected', userId);

    // Enviar a los usuarios existentes al nuevo usuario, excluyendo al anfitrión
    socket.emit(
      'existing-users',
      rooms[roomId].users.filter((id) => id !== userId) // Excluir al nuevo usuario
    );
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      // Eliminar al usuario desconectado de la sala
      rooms[roomId].users = rooms[roomId].users.filter((id) => id !== socket.id);

      // Si el usuario desconectado era el anfitrión, asignamos un nuevo anfitrión
      if (rooms[roomId].host === socket.id) {
        rooms[roomId].host = rooms[roomId].users[0]; // El primer usuario restante será el nuevo anfitrión
      }

      socket.to(roomId).emit('user-disconnected', socket.id); // Notificar desconexión
    }
    console.log(`Usuario desconectado: ${socket.id}`);
  });

  socket.on('offer', (offer, roomId, userId) => {
    socket.to(roomId).emit('offer', offer, userId);
  });

  socket.on('answer', (answer, roomId, userId) => {
    socket.to(roomId).emit('answer', answer, userId);
  });

  socket.on('ice-candidate', (candidate, roomId, userId) => {
    socket.to(roomId).emit('ice-candidate', candidate, userId);
  });
});
