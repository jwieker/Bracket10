import session from 'express-session';
import { sessionRepository } from '../repositories/index.js';

/**
 * express-session store adapter.
 *
 * Holds no Firestore handle of its own: every document read and write is
 * delegated to `SessionRepository`, which is the single owner of the
 * `express-sessions` collection. That class also implements
 * `clearAuthenticatedSessions` (the admin incident-response control), which
 * depends on the stored document shape — two independent owners of the same
 * collection could drift and silently break it.
 *
 * This class exists only to satisfy the callback-based `session.Store`
 * interface; the repository layer stays promise-based like every other.
 */
export class FirestoreStore extends session.Store {
  constructor({ repository = sessionRepository } = {}) {
    super();
    this.repository = repository;
  }

  get(sid, cb) {
    this.repository.getSession(sid).then(
      (data) => {
        if (!data) return cb(null, null);
        const { session: sess, expires } = data;
        if (expires && expires < Date.now()) {
          // Opportunistically delete on read so a missed TTL still self-heals.
          this.repository.deleteSession(sid).catch(() => {});
          return cb(null, null);
        }
        cb(null, sess);
      },
      // Two-arg form on purpose: a trailing .catch() would also observe errors
      // thrown by cb itself and invoke it a second time.
      (err) => cb(err),
    );
  }

  set(sid, sess, cb) {
    const expires = sess.cookie?.expires
      ? new Date(sess.cookie.expires).getTime()
      : Date.now() + 86400000;
    this.repository
      .setSession(sid, {
        session: JSON.parse(JSON.stringify(sess)),
        expires,
      })
      .then(
        () => cb(null),
        (err) => cb(err),
      );
  }

  destroy(sid, cb) {
    this.repository.deleteSession(sid).then(
      () => cb(null),
      (err) => cb(err),
    );
  }
}
