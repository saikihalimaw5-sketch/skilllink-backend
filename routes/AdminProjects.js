
const express = require("express");
const Project = require("../models/project");
const { verifyToken, checkRole } = require("../middleware/authMiddleware");

const router = express.Router();

// All routes are accessible to admins only.
router.use(verifyToken);
router.use(checkRole(["admin"]));

// ==========================================
// GET ALL PROJECTS - ADMIN ONLY
// GET /api/admin/projects
// ==========================================

router.get("/", async (req, res) => {
  try {
    const projects = await Project.find({})
      .populate(
        "owner",
        "username email profileImage avatarStyle"
      )
      .populate(
        "members",
        "username email profileImage avatarStyle"
      )
      .select("-joinRequests")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      totalProjects: projects.length,
      projects,
    });
  } catch (error) {
    console.error("Admin projects error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve projects.",
    });
  }
});

module.exports = router;
