import { controllerWrapper } from '../utils/controllerUtils.js';
import {
  thisYear,
  bracketLaunchDate,
  tourneyStartDate,
} from '../config/app.js';

const index = controllerWrapper(async (req, res) => {
  const nowZulu = new Date();

  // Determine what to show based on current time
  const showComingSoon = nowZulu <= bracketLaunchDate;
  const isTestEnvironment =
    process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development';
  const showCont2 = isTestEnvironment ? 'test' : nowZulu > tourneyStartDate;

  // Check for error in query params
  const error = req.query.error === 'true';
  const createError = req.query.createError === 'true';

  const state = isTestEnvironment
    ? 'test'
    : showComingSoon
      ? 'comingsoon'
      : showCont2
        ? 'tournament'
        : 'registration';

  res.render('index', {
    state,
    error,
    createError,
    thisYear,
    userEmail: req.session?.userEmail || null,
  });
}, 'index');

export { index };
