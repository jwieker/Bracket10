import express from "express";
import { index } from "../controllers/indexController.js";

const router = express.Router();

router.get("/", index); //view the home page

export default router;
