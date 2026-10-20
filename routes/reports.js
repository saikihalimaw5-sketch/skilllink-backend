
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const { verifyToken, checkRole } = require("../middleware/authMiddleware");
const Report = require("../models/Report");


// Use the authenticated user ID from the existing middleware
const getAuthenticatedUserId = (req) => {
  return (
    req.user?.id ||
    req.user?._id ||
    req.user?.userId ||
    req.user?.sub
  );
};

// POST /api/reports
// Submit a new report
router.post("/", verifyToken, async (req, res) => {
      try {
    const { reportType, subject, description } = req.body;

    const allowedTypes = [
      "Technical Issue",
      "User Complaint",
      "Project Issue",
    ];


if (
  !allowedTypes.includes(reportType) ||
  typeof subject !== "string" ||
  !subject.trim() ||
  subject.trim().length > 100 ||
  typeof description !== "string" ||
  description.length > 300
) {
  return res.status(400).json({
    message: "Please provide valid report details.",
  });
}


    const report = await Report.create({
      reporter: getAuthenticatedUserId(req),
      reportType,
      subject: subject.trim(),
      description: description.trim(),
    });

    return res.status(201).json({
      success: true,
      message: "Report submitted successfully.",
      report,
    });
  } catch (error) {
    console.error("Submit report error:", error);

    return res.status(500).json({
      message: "Failed to submit report.",
    });
  }
});

// GET /api/reports/my
// View own submitted reports
router.get("/my", verifyToken, async (req, res) => {
      try {
    const reports = await Report.find({
      reporter: getAuthenticatedUserId(req),
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      reports,
    });
  } catch (error) {
    console.error("Get my reports error:", error);

    return res.status(500).json({
      message: "Failed to load reports.",
    });
  }
});

/* ==========================================
   ADMIN - GET ALL USER REPORTS
   GET /api/reports/admin
========================================== */

router.get(
  "/admin",
  verifyToken,
  checkRole(["admin"]),
  async (req, res) => {
    try {
      const reports = await Report.find()
        .populate(
          "reporter",
          "username email profileImage avatarStyle"
        )
        .sort({ createdAt: -1 })
        .lean();

      const totalReports = reports.length;

      const pendingReports = reports.filter(
        (report) => report.status === "Pending"
      ).length;

      const resolvedReports = reports.filter(
        (report) => report.status === "Resolved"
      ).length;

      const dismissedReports = reports.filter(
        (report) => report.status === "Dismissed"
      ).length;

      return res.status(200).json({
        success: true,
        totalReports,
        pendingReports,
        resolvedReports,
        dismissedReports,
        reports,
      });
    } catch (error) {
      console.error("Admin get reports error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to retrieve user reports.",
      });
    }
  }
);

/* ==========================================
   ADMIN - UPDATE REPORT STATUS
   PATCH /api/reports/admin/:reportId
========================================== */

router.patch(
  "/admin/:reportId",
  verifyToken,
  checkRole(["admin"]),
  async (req, res) => {
    try {
      const { reportId } = req.params;
      const { status, adminResponse } = req.body;

      const allowedStatuses = [
        "Pending",
        "Resolved",
        "Dismissed",
      ];

      // Validate report ID
      if (!mongoose.isValidObjectId(reportId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid report ID.",
        });
      }

      // Validate status
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid report status.",
        });
      }

      // Validate optional admin response
      if (
        adminResponse !== undefined &&
        (typeof adminResponse !== "string" ||
          adminResponse.length > 1000)
      ) {
        return res.status(400).json({
          success: false,
          message: "Admin response must not exceed 1000 characters.",
        });
      }

      const updates = {
        status,
        resolvedAt: status === "Resolved" ? new Date() : null,
      };

      if (adminResponse !== undefined) {
        updates.adminResponse = adminResponse.trim();
      }

      const report = await Report.findByIdAndUpdate(
        reportId,
        { $set: updates },
        {
          new: true,
          runValidators: true,
        }
      ).populate(
        "reporter",
        "username email profileImage avatarStyle"
      );

      if (!report) {
        return res.status(404).json({
          success: false,
          message: "Report not found.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Report status updated successfully.",
        report,
      });
    } catch (error) {
      console.error("Admin update report error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to update report.",
      });
    }
  }
);

module.exports = router;
