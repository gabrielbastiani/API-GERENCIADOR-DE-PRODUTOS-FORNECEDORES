import { Router } from "express";
import { getDashboardSummary } from "../controllers/dashboard.controller";

const dashboardRoutes = Router();

dashboardRoutes.get("/summary", getDashboardSummary);

export default dashboardRoutes;