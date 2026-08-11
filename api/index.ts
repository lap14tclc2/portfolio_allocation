import { requestListener } from '../src/app';
import storageService from '../src/services/storage.service';

export default async function handler(req: any, res: any) {
  await storageService.initialize();
  return requestListener(req, res);
}
