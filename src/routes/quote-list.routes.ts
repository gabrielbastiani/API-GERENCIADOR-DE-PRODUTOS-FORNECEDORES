import { Router } from "express";
import {
  addItemsToQuoteList,
  createQuoteList,
  deleteQuoteList,
  getQuoteList,
  listQuoteLists,
  removeItemFromQuoteList,
  updateQuoteList
} from "../controllers/quote-list.controller";

const router = Router();

router.get("/", listQuoteLists);
router.post("/", createQuoteList);

router.get("/:id", getQuoteList);
router.patch("/:id", updateQuoteList);
router.delete("/:id", deleteQuoteList);

router.post("/:id/items", addItemsToQuoteList);
router.delete("/:id/items/:itemId", removeItemFromQuoteList);

export default router;