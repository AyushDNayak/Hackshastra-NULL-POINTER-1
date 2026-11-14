import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { authenticateTokenString, type AuthenticatedUser } from '../middleware/auth.ts';

interface ClientMeta {
  ws: WebSocket;
  user: AuthenticatedUser;
}

const clients = new Set<ClientMeta>();

export function initWebSocketServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    try {
      const url = new URL(req.url || '/ws', 'http://localhost');
      const token = url.searchParams.get('token') || '';
      const user = await authenticateTokenString(token);
      if (!user) {
        ws.close(4001, 'Unauthorized');
        return;
      }

      const meta: ClientMeta = { ws, user };
      clients.add(meta);

      ws.send(
        JSON.stringify({
          event: 'connected',
          payload: { userId: user.id, role: user.role },
        })
      );

      ws.on('close', () => {
        clients.delete(meta);
      });

      ws.on('error', () => {
        clients.delete(meta);
      });
    } catch {
      ws.close(4001, 'Authentication error');
    }
  });

  return wss;
}

export function broadcastToUser(userId: number, event: string, payload: unknown) {
  const message = JSON.stringify({ event, payload });
  for (const client of clients) {
    if (client.user.id === userId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  }
}

export function broadcastToDepartmentAndAdmins(
  departmentId: number | null,
  event: string,
  payload: unknown
) {
  const message = JSON.stringify({ event, payload });
  for (const client of clients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    const isAdmin = client.user.role === 'ADMIN';
    const isDeptStaff =
      client.user.role === 'STAFF' && departmentId !== null && client.user.departmentId === departmentId;
    if (isAdmin || isDeptStaff) {
      client.ws.send(message);
    }
  }
}

export function broadcastComplaintEvent(
  complainantUserId: number,
  departmentId: number | null,
  event: string,
  payload: unknown
) {
  const message = JSON.stringify({ event, payload });
  for (const client of clients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    const isOwner = client.user.id === complainantUserId;
    const isAdmin = client.user.role === 'ADMIN';
    const isDeptStaff =
      client.user.role === 'STAFF' && departmentId !== null && client.user.departmentId === departmentId;
    if (isOwner || isAdmin || isDeptStaff) {
      client.ws.send(message);
    }
  }
}
