import { Firestore } from '@google-cloud/firestore';
import session from 'express-session';

export class FirestoreStore extends session.Store {
  constructor({ dataset, kind = 'express-sessions' } = {}) {
    super();
    this.col = dataset.collection(kind);
  }

  get(sid, cb) {
    this.col
      .doc(sid)
      .get()
      .then((doc) => {
        if (!doc.exists) return cb(null, null);
        const { session, expires } = doc.data();
        if (expires && expires < Date.now()) {
          // Opportunistically delete on read so a missed TTL still self-heals.
          this.col
            .doc(sid)
            .delete()
            .catch(() => {});
          return cb(null, null);
        }
        cb(null, session);
      }, cb);
  }

  set(sid, session, cb) {
    const expires = session.cookie?.expires
      ? new Date(session.cookie.expires).getTime()
      : Date.now() + 86400000;
    this.col
      .doc(sid)
      .set({
        session: JSON.parse(JSON.stringify(session)),
        expires,
        // Lets a Firestore TTL policy on `expireAt` reap dead sessions
        // automatically (same pattern as the rateLimits store).
        expireAt: Firestore.Timestamp.fromMillis(expires),
      })
      .then(() => cb(null), cb);
  }

  destroy(sid, cb) {
    this.col
      .doc(sid)
      .delete()
      .then(() => cb(null), cb);
  }
}
