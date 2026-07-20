import { verifyDatabaseAccess } from '../src/utils/startupChecks.js';

const { listCollectionsMock, loggerInfoMock, loggerErrorMock } = vi.hoisted(
  () => ({
    listCollectionsMock: vi.fn(),
    loggerInfoMock: vi.fn(),
    loggerErrorMock: vi.fn(),
  }),
);

vi.mock('../src/config/firestore.js', () => ({
  db: {
    listCollections: listCollectionsMock,
  },
}));

vi.mock('../src/utils/logger.js', () => ({
  default: {
    info: loggerInfoMock,
    error: loggerErrorMock,
  },
}));

describe('startupChecks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('verifyDatabaseAccess successfully accesses Firestore', async () => {
    listCollectionsMock.mockResolvedValue([]);
    await expect(verifyDatabaseAccess()).resolves.toBeUndefined();
    expect(listCollectionsMock).toHaveBeenCalledTimes(1);
    expect(loggerInfoMock).toHaveBeenCalledWith(
      'Verifying Firestore database access...',
    );
    expect(loggerInfoMock).toHaveBeenCalledWith(
      'Successfully accessed Firestore. Permissions are sufficient.',
    );
  });

  test('verifyDatabaseAccess handles error and throws a new Error', async () => {
    listCollectionsMock.mockRejectedValue(
      new Error('Firebase Permission Denied'),
    );
    await expect(verifyDatabaseAccess()).rejects.toThrow(
      'Firestore access check failed: Firebase Permission Denied',
    );
    expect(listCollectionsMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to verify Firestore access:',
      'Firebase Permission Denied',
    );
  });
});
