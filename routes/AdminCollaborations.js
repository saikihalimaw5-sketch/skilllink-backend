
const express = require("express");
const Project = require("../models/project");
const { verifyToken, checkRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(verifyToken);
router.use(checkRole(["admin"]));

// GET /api/admin/collaborations
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
      .populate(
        "joinRequests.user",
        "username email profileImage avatarStyle"
      )
      .sort({ createdAt: -1 })
      .lean();

    const collaborations = projects.flatMap((project) => {
      const acceptedMembers = (project.members || [])
        .filter((member) => {
            if (!member) return false;

            const memberId = String(member._id);
            const ownerId = project.owner?._id
            ? String(project.owner._id)
            : "";

            return memberId !== ownerId;
        })
        .map((member) => ({
          _id: `${project._id}-${member._id}`,
          projectId: project._id,
          projectTitle: project.title,
          owner: project.owner,
          user: member,
          status:
            project.status === "Completed"
              ? "Completed"
              : project.status === "Archived"
              ? "Archived"
              : "Ongoing",
          date: project.createdAt,
          projectStatus: project.status,
        }));

      const pendingRequests = (project.joinRequests || [])
        .filter((request) => request.status === "Pending")
        .map((request) => ({
          _id: String(request._id),
          projectId: project._id,
          projectTitle: project.title,
          owner: project.owner,
          user: request.user,
          status: "Pending",
          date: request.requestedAt,
          projectStatus: project.status,
        }));

      const rejectedRequests = (project.joinRequests || [])
        .filter((request) => request.status === "Rejected")
        .map((request) => ({
          _id: String(request._id),
          projectId: project._id,
          projectTitle: project.title,
          owner: project.owner,
          user: request.user,
          status: "Rejected",
          date: request.respondedAt || request.requestedAt,
          projectStatus: project.status,
        }));

      return [
        ...acceptedMembers,
        ...pendingRequests,
        ...rejectedRequests,
      ];
    });

    return res.status(200).json({
      success: true,
      totalCollaborations: collaborations.length,
      collaborations,
    });
  } catch (error) {
    console.error(
      "Admin collaborations error:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve collaborations.",
    });
  }
});

module.exports = router;
