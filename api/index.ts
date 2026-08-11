import { createApp } from '../src/app';
import storageService from '../src/services/storage.service';

const server = createApp();

export default async function handler(req: any, res: any) {
  await storageService.initialize();
  server.emit('request', req, res);
}
