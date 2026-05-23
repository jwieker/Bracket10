import session from 'express-session';

export class FirestoreStore extends session.Store {
  constructor({ dataset, kind = 'express-sessions' } = {}) {
    super();
    this.col = dataset.collection(kind);
  }

  get(sid, cb) {
    this.col.doc(sid).get()
      .then(doc => {
        if (!doc.exists) return cb(null, null);
        const { session, expires } = doc.data();
        if (expires && expires < Date.now()) return cb(null, null);
        cb(null, session);
      })
      .catch(cb);
  }

  set(sid, session, cb) {
    const expires = session.cookie?.expires
      ? new Date(session.cookie.expires).getTime()
      : Date.now() + 86400000;
    this.col.doc(sid).set({ session: JSON.parse(JSON.stringify(session)), expires })
      .then(() => cb(null))
      .catch(cb);
  }

  destroy(sid, cb) {
    this.col.doc(sid).delete()
      .then(() => cb(null))
      .catch(cb);
  }
}
