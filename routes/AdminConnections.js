
const express = require("express");
const Connection = require("../models/Connection");
const {
  verifyToken,
  checkRole,
} = require("../middleware/authMiddleware");

const router = express.Router();

// ADMIN ONLY
router.use(verifyToken);
router.use(checkRole(["admin"]));

// ==========================================
// GET ALL PEOPLE CONNECTIONS
// GET /api/admin/connections
// ==========================================

router.get("/", async (req, res) => {
  try {
    const connections = await Connection.find({})
      .populate(
        "requester",
        "username email profileImage avatarStyle"
      )
      .populate(
        "recipient",
        "username email profileImage avatarStyle"
      )
      .select("-note")
      .sort({ createdAt: -1 })
      .lean();

    const stats = {
      totalConnections: connections.length,
      pendingConnections: 0,
      acceptedConnections: 0,
      declinedConnections: 0,
    };

    connections.forEach((connection) => {
      if (connection.status === "pending") {
        stats.pendingConnections++;
      } else if (connection.status === "accepted") {
        stats.acceptedConnections++;
      } else if (connection.status === "declined") {
        stats.declinedConnections++;
      }
    });

    return res.status(200).json({
      success: true,
      stats,
      totalRecords: connections.length,
      connections,
    });
  } catch (error) {
    console.error(
      "Admin connections error:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve people connections.",
    });
  }
});

module.exports = router;
