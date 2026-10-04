import express from 'express';
import { index } from '../controllers/indexController.js';
import { privacy } from '../controllers/privacyController.js';
import { scoring } from '../controllers/scoringController.js';

const router = express.Router();

router.get('/', index); //view the home page
router.get('/privacy', privacy);
router.get('/scoring', scoring); //view the scoring explainer page

export default router;
