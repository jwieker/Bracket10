import { controllerWrapper } from '../utils/controllerUtils.js';

const privacy = controllerWrapper(async (req, res) => {
  res.render('privacy');
}, 'privacy');

export { privacy };
