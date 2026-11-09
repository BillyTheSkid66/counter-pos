import pg from 'pg';
// Standard PostgreSQL over TCP; no hosted database or WebSocket service needed.
export const {Pool,Client}=pg;
