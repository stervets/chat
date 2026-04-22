import {db, closeDb} from '../db.js';

async function run() {
  await db.$executeRawUnsafe(`
    truncate table
      message_reactions,
      messages,
      game_session_players,
      game_sessions,
      rooms_users,
      rooms,
      nodes,
      push_subscriptions,
      sessions,
      invites,
      users
    restart identity cascade
  `);

  process.stdout.write('Database reset completed (PostgreSQL).\n');
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeDb();
  });
