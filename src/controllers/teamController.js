import { teamRepository, conferenceRepository } from "../repositories/index.js";
import { controllerWrapper } from "../utils/controllerUtils.js";

// GET /viewTeam
const viewTeam = controllerWrapper(async (req, res) => {
  const { teamId } = req.query;
  if (!teamId) {
    return res.status(400).send("Missing teamId");
  }
  const [team, conferences] = await Promise.all([
    teamRepository.getSchoolById(Number(teamId)),
    conferenceRepository.getAllConferences(),
  ]);

  if (!team) {
    return res.status(404).send("School not found");
  }

  res.render("editTeam", { team, isNew: false, conferences });
}, "viewTeam");

// POST /updateTeam
const updateTeam = controllerWrapper(async (req, res) => {
  const { sid, name, mascot, nameNick, confID } = req.body;
  if (!sid || !name) {
    return res.status(400).send("Missing required fields");
  }

  // Parse conferenceHistory rows submitted from form:
  // confHistory[0][confID], confHistory[0][startYear], confHistory[0][endYear], ...
  const historyRaw = req.body.confHistory;
  let conferenceHistory;
  if (historyRaw && Array.isArray(historyRaw)) {
    conferenceHistory = historyRaw
      .filter(row => row.confID && row.confID.trim() !== '')
      .map(row => ({
        confID: row.confID.trim(),
        startYear: row.startYear ? Number(row.startYear) : null,
        endYear: row.endYear ? Number(row.endYear) : null,
      }));
  }

  // Parse ESPN fields from espn[field] form inputs (parsed as req.body.espn by body-parser)
  const espnRaw = req.body.espn;
  let espn;
  if (espnRaw && typeof espnRaw === 'object') {
    espn = {
      espnID: espnRaw.espnID ? Number(espnRaw.espnID) : null,
      espnSlug: espnRaw.espnSlug?.trim() || null,
      espnAbbreviation: espnRaw.espnAbbreviation?.trim() || null,
      espnShortName: espnRaw.espnShortName?.trim() || null,
      primaryColor: espnRaw.primaryColor?.trim() || null,
      alternateColor: espnRaw.alternateColor?.trim() || null,
      logoURL: espnRaw.logoURL?.trim() || null,
    };
  }

  await teamRepository.updateSchool({ sid: Number(sid), name, mascot, nameNick, confID });
  if (conferenceHistory) {
    await teamRepository.updateSchoolConferenceHistory(Number(sid), conferenceHistory);
  }
  if (espn) {
    await teamRepository.updateSchoolEspn(Number(sid), espn);
  }

  res.redirect(`/viewTeam?teamId=${sid}`);
}, "updateTeam");

// Add this controller for finding teams by name
const findTeam = controllerWrapper(async (req, res) => {
  const { name } = req.query;
  if (!name) {
    return res.status(400).json({ error: "Name is required." });
  }
  const teams = await teamRepository.findSchoolsByName(name);
  res.json(teams);
}, "findTeam");

const addTeamPage = controllerWrapper(async (req, res) => {
  const conferences = await conferenceRepository.getAllConferences();
  res.render("editTeam", {
    team: { sid: "", name: "", mascot: "", nameNick: "", confID: "", conferenceHistory: [] },
    isNew: true,
    conferences,
  });
}, "addTeamPage");

const addTeam = controllerWrapper(async (req, res) => {
  const { name, mascot, nameNick, confID } = req.body;
  if (!name) {
    return res.status(400).send("School name is required");
  }
  const maxSid = await teamRepository.getMaxSchoolId();
  const newSid = (maxSid || 0) + 1;
  await teamRepository.insertSchool({
    sid: newSid,
    name,
    mascot,
    nameNick,
    confID: confID || null,
  });
  res.redirect(`/viewTeam?teamId=${newSid}`);
}, "addTeam");

// JSON-returning version for AJAX use (e.g. inline add on newTourneyGames page)
const addTeamApi = controllerWrapper(async (req, res) => {
  const { name, mascot, nameNick, confID } = req.body;
  if (!name) {
    return res.status(400).json({ error: "School name is required" });
  }
  const maxSid = await teamRepository.getMaxSchoolId();
  const newSid = (maxSid || 0) + 1;
  await teamRepository.insertSchool({
    sid: newSid,
    name,
    mascot,
    nameNick,
    confID: confID || null,
  });
  res.status(201).json({ sid: newSid, name, mascot, nameNick, confID: confID || null });
}, "addTeamApi");

// Add this controller for deleting a team and redirecting to /updates
const deleteTeam = controllerWrapper(async (req, res) => {
  const { sid } = req.body;
  if (!sid) {
    return res.status(400).send("Missing team id");
  }
  await teamRepository.deleteSchool(Number(sid));
  res.redirect("/updates");
}, "deleteTeam");

export {
  viewTeam,
  updateTeam,
  findTeam,
  addTeamPage,
  addTeam,
  addTeamApi,
  deleteTeam,
};
