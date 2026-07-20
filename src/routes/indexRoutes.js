import express from 'express';
import { index } from '../controllers/indexController.js';
import { scoring } from '../controllers/scoringController.js';

const router = express.Router();

router.get('/', index); //view the home page
router.get('/scoring', scoring); //view the scoring explainer page

export default router;
