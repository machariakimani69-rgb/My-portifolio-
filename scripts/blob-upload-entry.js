import { upload } from '@vercel/blob/client';

window.uploadPortfolioFile = (file) => upload(crypto.randomUUID(), file, {
  access: 'private',
  handleUploadUrl: '/api/admin/uploads',
  clientPayload: JSON.stringify({ fileName: file.name }),
});
