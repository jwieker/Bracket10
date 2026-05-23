import { conferenceRepository } from '../repositories/index.js';
import { controllerWrapper, validateConferencePayload } from '../utils/controllerUtils.js';

function parseActiveFlag(raw) {
  return raw === 'true' || raw === true || raw === 'on';
}

// GET /conferences — list all conferences
export const listConferences = controllerWrapper(async (req, res) => {
    const conferences = await conferenceRepository.getAllConferences();
    res.render('manageConferences', { conferences });
}, 'listConferences');

// GET /viewConference?slug=acc — edit form
export const viewConference = controllerWrapper(async (req, res) => {
    const { slug } = req.query;
    if (!slug) return res.status(400).send('Missing slug');
    const conference = await conferenceRepository.getConferenceBySlug(slug);
    if (!conference) return res.status(404).send('Conference not found');
    res.render('editConference', { conference, isNew: false });
}, 'viewConference');

// POST /updateConference
export const updateConference = controllerWrapper(async (req, res) => {
    const { slug, name, shortName, division, active } = req.body;
    validateConferencePayload({ slug, name, shortName, division });
    await conferenceRepository.updateConference(slug, {
        name,
        shortName: shortName || name,
        division: division || 'I',
        active: parseActiveFlag(active),
    });
    res.redirect(`/viewConference?slug=${slug}`);
}, 'updateConference');

// GET /addConferencePage — blank form
export const addConferencePage = controllerWrapper(async (req, res) => {
    res.render('editConference', {
        conference: { slug: '', name: '', shortName: '', division: 'I', active: true },
        isNew: true,
    });
}, 'addConferencePage');

// POST /addConference
export const addConference = controllerWrapper(async (req, res) => {
    const { slug, name, shortName, division, active } = req.body;
    validateConferencePayload({ slug, name, shortName, division });

    // Check for duplicate
    const existing = await conferenceRepository.getConferenceBySlug(slug);
    if (existing) return res.status(409).send(`Conference slug "${slug}" already exists`);

    await conferenceRepository.insertConference({
        slug,
        name,
        shortName: shortName || name,
        division: division || 'I',
        active: parseActiveFlag(active),
    });
    res.redirect(`/viewConference?slug=${slug}`);
}, 'addConference');
