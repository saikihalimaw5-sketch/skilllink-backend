
const express = require("express");
const mongoose = require("mongoose");

const SupportTicket = require("../models/SupportTicket");
const { verifyToken, checkRole } = require("../middleware/authMiddleware");

const router = express.Router();

const getUserId = (user) =>
  user?.id || user?._id || user?.userId || user?.sub;

// USER - Submit support inquiry
router.post("/", verifyToken, async (req, res) => {
  try {
    const userId = getUserId(req.user);
    const { subject, category, description } = req.body;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(401).json({
        message: "Invalid user session.",
      });
    }

    if (
      typeof subject !== "string" ||
      !subject.trim() ||
      subject.trim().length > 150 ||
      typeof description !== "string" ||
      !description.trim() ||
      description.trim().length > 2000 ||
      !["general", "account", "matching"].includes(category)
    ) {
      return res.status(400).json({
        message: "Please provide valid support details.",
      });
    }

    const ticket = await SupportTicket.create({
      user: userId,
      subject: subject.trim(),
      category,
      description: description.trim(),
    });

    return res.status(201).json({
      success: true,
      message: "Support inquiry submitted successfully.",
      ticket,
    });
  } catch (error) {
    console.error("Submit support error:", error);
    return res.status(500).json({
      message: "Unable to submit support inquiry.",
    });
  }
});

// USER - View own support tickets
router.get("/my", verifyToken, async (req, res) => {
  try {
    const userId = getUserId(req.user);

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(401).json({
        message: "Invalid user session.",
      });
    }

    const tickets = await SupportTicket.find({ user: userId })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      tickets,
    });
  } catch (error) {
    console.error("My support tickets error:", error);
    return res.status(500).json({
      message: "Unable to load support tickets.",
    });
  }
});

// ADMIN - View all support tickets
router.get(
  "/admin",
  verifyToken,
  checkRole(["admin"]),
  async (req, res) => {
    try {
      const tickets = await SupportTicket.find()
        .populate("user", "username email profileImage avatarStyle")
        .sort({ createdAt: -1 })
        .lean();

      return res.status(200).json({
        success: true,
        tickets,
      });
    } catch (error) {
      console.error("Admin support error:", error);
      return res.status(500).json({
        message: "Unable to load support tickets.",
      });
    }
  }
);

// ADMIN - Send or update response
router.patch(
  "/admin/:ticketId/respond",
  verifyToken,
  checkRole(["admin"]),
  async (req, res) => {
    try {
      const { ticketId } = req.params;
      const { adminResponse } = req.body;

      if (!mongoose.isValidObjectId(ticketId)) {
        return res.status(400).json({
          message: "Invalid ticket ID.",
        });
      }

      if (
        typeof adminResponse !== "string" ||
        !adminResponse.trim() ||
        adminResponse.trim().length > 2000
      ) {
        return res.status(400).json({
          message: "Response must be 1–2000 characters.",
        });
      }

      const ticket = await SupportTicket.findByIdAndUpdate(
        ticketId,
        {
          $set: {
            adminResponse: adminResponse.trim(),
            status: "Replied",
            respondedAt: new Date(),
            resolvedAt: null,
          },
        },
        { new: true, runValidators: true }
      );

      if (!ticket) {
        return res.status(404).json({
          message: "Support ticket not found.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Response sent successfully.",
        ticket,
      });
    } catch (error) {
      console.error("Admin response error:", error);
      return res.status(500).json({
        message: "Unable to send response.",
      });
    }
  }
);

// USER - Confirm whether concern is resolved
router.patch("/:ticketId/status", verifyToken, async (req, res) => {
  try {
    const userId = getUserId(req.user);
    const { ticketId } = req.params;
    const { status } = req.body;

    if (
      !mongoose.isValidObjectId(userId) ||
      !mongoose.isValidObjectId(ticketId) ||
      !["Open", "Resolved"].includes(status)
    ) {
      return res.status(400).json({
        message: "Invalid ticket or status.",
      });
    }

    const ticket = await SupportTicket.findOne({
      _id: ticketId,
      user: userId,
    });

    if (!ticket) {
      return res.status(404).json({
        message: "Support ticket not found.",
      });
    }

    if (!ticket.adminResponse?.trim()) {
      return res.status(400).json({
        message: "Please wait for an admin response.",
      });
    }

    if (status === "Resolved" && ticket.status !== "Replied") {
      return res.status(400).json({
        message: "Only replied tickets can be marked resolved.",
      });
    }

    ticket.status = status;
    ticket.resolvedAt = status === "Resolved" ? new Date() : null;

    await ticket.save();

    return res.status(200).json({
      success: true,
      message: "Support ticket status updated.",
      ticket,
    });
  } catch (error) {
    console.error("Support status error:", error);
    return res.status(500).json({
      message: "Unable to update ticket status.",
    });
  }
});

module.exports = router;
