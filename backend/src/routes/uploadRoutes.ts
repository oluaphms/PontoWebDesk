import { Router } from 'express';
import express from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { uploadPhotoController } from '../controllers/uploadController.js';
import { serveUploadFileController } from '../controllers/uploadServeController.js';

const router = Router();

/** JSON até ~7 MB (foto 5 MB em base64). */
const jsonUpload = express.json({ limit: '7mb' });

router.post('/photo', jsonUpload, authMiddleware, uploadPhotoController);
router.get('/files/:userId/:fileName', serveUploadFileController);

export default router;
