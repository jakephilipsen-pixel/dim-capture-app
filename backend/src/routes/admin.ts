import { Router } from "express";

const router = Router();

router.post("/seed", (_req, res) => res.status(501).json({ error: "Not implemented" }));
router.get("/progress", (_req, res) => res.status(501).json({ error: "Not implemented" }));

export default router;
