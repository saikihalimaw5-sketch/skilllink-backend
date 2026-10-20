const express = require("express");
const router = express.Router();

const HobbySkill = require("../models/HobbySkill");
const User = require("../models/User");

const {
  verifyToken,
  checkRole,
} = require("../middleware/authMiddleware");

// All endpoints in this file are ADMIN ONLY.
router.use(verifyToken, checkRole(["admin"]));

// GET /api/admin/hobbies
// Retrieve real hobbies and skills from MongoDB.
router.get("/", async (req, res) => {
  try {
    const records = await HobbySkill.find()
      .sort({ createdAt: -1 })
      .lean();

    // Count students who selected each hobby or skill.
    const studentHobbies = await User.find({
      role: "student",
    })
      .select("hobbies")
      .lean();

    const items = records.map((record) => {
      const totalUsers = studentHobbies.filter((user) =>
        (user.hobbies || []).some(
          (name) =>
            typeof name === "string" &&
            name.toLowerCase() === record.name.toLowerCase()
        )
      ).length;

      return {
        ...record,
        totalUsers,
      };
    });

    return res.status(200).json({
      success: true,
      items,
      totalItems: items.length,
    });
  } catch (error) {
    console.error("Admin hobbies error:", error.message);

    return res.status(500).json({
      message: "Failed to retrieve hobbies and skills.",
    });
  }
});

module.exports = router;