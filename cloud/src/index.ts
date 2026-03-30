/**
 * Axon Vision Safety Demo - Express Server
 * 
 * This server provides the API endpoint for image safety analysis
 * using Google Gemini's vision capabilities via OpenRouter.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import analyzeRoute from './analyzeRoute.js';
import alertRoute from './alertRoute.js';
import videoAnalysisRoute from './videoAnalysisRoute.js';
import videoStreamingRoute from './videoStreamingRoute.js';
import videoFolderRoute from './videoFolderRoute.js';
import analyzeFrameRoute from './analyzeFrameRoute.js';
import configRoute from './configRoute.js';
import deepvisionRoute, { startBackgroundLoops, stopBackgroundLoops } from './backgroundLoop.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for the React frontend (allow any origin for edge deployment)
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Parse JSON bodies
app.use(express.json());

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount the analyze routes
app.use('/api', analyzeRoute);
app.use('/api', alertRoute);
app.use('/api', videoAnalysisRoute);
app.use('/api', videoStreamingRoute);
app.use('/api', videoFolderRoute);
app.use('/api', analyzeFrameRoute);
app.use('/api', configRoute);
app.use('/api', deepvisionRoute);

// Serve static files from the React app (in production) - only if build exists
const clientBuildPath = path.resolve(__dirname, '../../ppe-ui/dist');
if (existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
  
  // Serve index.html for all non-API routes (SPA routing)
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      const indexPath = path.join(clientBuildPath, 'index.html');
      if (existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).json({
          success: false,
          error: 'Frontend not built. Please build the React app first.',
        });
      }
    }
  });
} else {
  // If frontend build doesn't exist, just return a message for non-API routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.status(404).json({
        success: false,
        error: 'Frontend not available. This is an API-only server.',
        message: 'Use the API endpoints at /api/*',
      });
    }
  });
}

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'An unexpected server error occurred. Please try again.',
  });
});

// Graceful shutdown: kill ffmpeg/go2rtc children before exiting
process.on('SIGTERM', () => {
  console.log('[server] SIGTERM received — stopping background loops');
  stopBackgroundLoops();
  process.exit(0);
});
process.on('SIGINT', () => {
  stopBackgroundLoops();
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`\n  Axon Vision Safety API Server`);
  console.log(`   Running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/api/health`);
  console.log(`   Config API:   GET/PUT http://localhost:${PORT}/api/config`);
  console.log(`   Deep Vision:  GET http://localhost:${PORT}/api/deepvision/latest`);
  console.log(`   Analyze:      POST http://localhost:${PORT}/api/analyze-image`);
  console.log(`   Services:     GET http://localhost:${PORT}/api/services/status\n`);

  startBackgroundLoops();
});
