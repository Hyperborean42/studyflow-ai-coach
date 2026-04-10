import { Router, type IRouter } from "express";
import healthRouter from "./health";
import openaiRouter from "./openai";
import studyMaterialsRouter from "./studyMaterials";
import studyGoalsRouter from "./studyGoals";
import calendarEventsRouter from "./calendarEvents";
import progressRouter from "./progress";
import settingsRouter from "./settingsRoutes";
import agentRouter from "./agent";
import translateRouter from "./translate";
import coachRouter from "./coach";

const router: IRouter = Router();

router.use(healthRouter);
router.use(openaiRouter);
router.use(studyMaterialsRouter);
router.use(studyGoalsRouter);
router.use(calendarEventsRouter);
router.use(progressRouter);
router.use(settingsRouter);
router.use(agentRouter);
router.use(translateRouter);
router.use(coachRouter);

export default router;
