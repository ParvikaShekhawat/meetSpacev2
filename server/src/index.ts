import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';                    // NEW
import positionRoutes from './routes/position.routes';
import candidateRoutes from './routes/candidate.routes';
import questionRoutes from './routes/question.routes';
import cookieParser from 'cookie-parser';
import { config } from './config/env';
import authRoutes from './routes/auth.routes';
import interviewRoutes from './routes/interview.routes';
import { initSocketServer } from './services/socket.service'; // NEW

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(cookieParser());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'MeetSpace server is alive' });
});

app.use('/api/positions', positionRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/interviews', interviewRoutes);

const httpServer = createServer(app);        // NEW - wraps express app
initSocketServer(httpServer);                 // NEW - attaches socket.io

httpServer.listen(PORT, () => {              // CHANGED from app.listen
  console.log(`Server running on http://localhost:${PORT}`);
});