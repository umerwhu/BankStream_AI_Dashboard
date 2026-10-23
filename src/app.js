import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRouter } from './routes/api.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { securityHeaders, rateLimit } from './middleware/security.js';

const app = express();
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(express.json({ limit: '256kb' }));
app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store, max-age=0');res.set('Pragma','no-cache');next();});
app.use('/api',rateLimit({windowMs:60_000,max:180}));
app.use('/api', apiRouter);
app.use(express.static(path.resolve(publicDir),{setHeaders(res,filePath){if(/\.(?:html|js|css)$/i.test(filePath))res.setHeader('Cache-Control','no-store');}}));
app.use('/api', notFound);
app.use(errorHandler);
export default app;
