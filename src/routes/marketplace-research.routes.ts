import { Router } from "express";
import {
  createResearch,
  deleteResearch,
  listResearch,
  updateResearch
} from "../controllers/marketplace-research.controller";

const marketplaceResearchRoutes = Router();

marketplaceResearchRoutes.get("/", listResearch);
marketplaceResearchRoutes.post("/", createResearch);
marketplaceResearchRoutes.put("/:id", updateResearch);
marketplaceResearchRoutes.delete("/:id", deleteResearch);

export default marketplaceResearchRoutes;