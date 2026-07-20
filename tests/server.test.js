import { getFuturePoints } from '../src/services/pointsService.js';

afterEach(() => {
  vi.clearAllMocks();
});

test('getFuturePoints for an array that does not need any games removed', async () => {
  const futureGames = [
    ['W', 'W', 13, 15, 61, 63],
    ['W', 'W', 59, 60, 62],
    ['W', 'W', 28, 30],
  ];
  const currentPoints = 41;
  const expectedPoints = 150;
  //     [
  //     [ 'W', 'W', 13, 15, 61, 63 ],
  //     [ 'W', 'W', 59, 60, 62 ],
  //     [ 'W', 'W', 28, 30 ]
  //   ]
  //   i = 0 j = 3. Current points 41  adding roundPoints 5  w/ futureGame 15
  //   i = 0 j = 4. Current points 46  adding roundPoints 9  w/ futureGame 61
  //   i = 0 j = 5. Current points 55  adding roundPoints 17  w/ futureGame 63
  //   i = 0 j = 6. Current points 72  adding roundPoints 33  w/ futureGame undefined
  //   i = 1 j = 3. Current points 105  adding roundPoints 5  w/ futureGame 60
  //   i = 1 j = 4. Current points 110  adding roundPoints 9  w/ futureGame 62
  //   i = 1 j = 5. Current points 119  adding roundPoints 17  w/ futureGame undefined
  //   i = 2 j = 3. Current points 136  adding roundPoints 5  w/ futureGame 30
  //   i = 2 j = 4. Current points 141  adding roundPoints 9  w/ futureGame undefined
  //   After calculation points: 150

  const points = await getFuturePoints(futureGames, currentPoints);
  expect(points).toBe(expectedPoints);
});

test('getFuturePoints for team that has a full tournament', async () => {
  const futureGames = [
    [46, 54, 58, 60, 62, 63],
    [23, 27, 29, 30, 61, 63],
    [6, 11, 14, 15, 61, 63],
    [4, 10, 13, 15, 61, 63],
    [33, 40, 43, 45, 62, 63],
    [50, 56, 59, 60, 62, 63],
    [37, 42, 44, 45, 62, 63],
    [17, 24, 28, 30, 61, 63],
    [35, 41, 44, 45, 62, 63],
    [18, 25, 28, 30, 61, 63],
  ];

  // const futureGames = [ //after removing duplicates
  //     [46, 54, 58, 60, 62, 63],
  //     [23, 27, 29, 30, 61],
  //     [6, 11, 14, 15],
  //     [4, 10, 13],
  //     [33, 40, 43, 45],
  //     [50, 56, 59],
  //     [37, 42, 44],
  //     [17, 24, 28],
  //     [35, 41],
  //     [18, 25]
  // ];
  const currentPoints = 0;
  const expectedPoints = 193;
  //   i = 0 j = 1. Current points 0  adding roundPoints 2  w/ futureGame 54
  //   i = 0 j = 2. Current points 2  adding roundPoints 3  w/ futureGame 58
  //   i = 0 j = 3. Current points 5  adding roundPoints 5  w/ futureGame 60
  //   i = 0 j = 4. Current points 10  adding roundPoints 9  w/ futureGame 62
  //   i = 0 j = 5. Current points 19  adding roundPoints 17  w/ futureGame 63
  //   i = 0 j = 6. Current points 36  adding roundPoints 33  w/ futureGame undefined
  //   i = 1 j = 1. Current points 69  adding roundPoints 2  w/ futureGame 27
  //   i = 1 j = 2. Current points 71  adding roundPoints 3  w/ futureGame 29
  //   i = 1 j = 3. Current points 74  adding roundPoints 5  w/ futureGame 30
  //   i = 1 j = 4. Current points 79  adding roundPoints 9  w/ futureGame 61
  //   i = 1 j = 5. Current points 88  adding roundPoints 17  w/ futureGame undefined
  //   i = 2 j = 1. Current points 105  adding roundPoints 2  w/ futureGame 11
  //   i = 2 j = 2. Current points 107  adding roundPoints 3  w/ futureGame 14
  //   i = 2 j = 3. Current points 110  adding roundPoints 5  w/ futureGame 15
  //   i = 2 j = 4. Current points 115  adding roundPoints 9  w/ futureGame undefined
  //   i = 3 j = 1. Current points 124  adding roundPoints 2  w/ futureGame 10
  //   i = 3 j = 2. Current points 126  adding roundPoints 3  w/ futureGame 13
  //   i = 3 j = 3. Current points 129  adding roundPoints 5  w/ futureGame undefined
  //   i = 4 j = 1. Current points 134  adding roundPoints 2  w/ futureGame 40
  //   i = 4 j = 2. Current points 136  adding roundPoints 3  w/ futureGame 43
  //   i = 4 j = 3. Current points 139  adding roundPoints 5  w/ futureGame 45
  //   i = 4 j = 4. Current points 144  adding roundPoints 9  w/ futureGame undefined
  //   i = 5 j = 1. Current points 153  adding roundPoints 2  w/ futureGame 56
  //   i = 5 j = 2. Current points 155  adding roundPoints 3  w/ futureGame 59
  //   i = 5 j = 3. Current points 158  adding roundPoints 5  w/ futureGame undefined
  //   i = 6 j = 1. Current points 163  adding roundPoints 2  w/ futureGame 42
  //   i = 6 j = 2. Current points 165  adding roundPoints 3  w/ futureGame 44
  //   i = 6 j = 3. Current points 168  adding roundPoints 5  w/ futureGame undefined
  //   i = 7 j = 1. Current points 173  adding roundPoints 2  w/ futureGame 24
  //   i = 7 j = 2. Current points 175  adding roundPoints 3  w/ futureGame 28
  //   i = 7 j = 3. Current points 178  adding roundPoints 5  w/ futureGame undefined
  //   i = 8 j = 1. Current points 183  adding roundPoints 2  w/ futureGame 41
  //   i = 8 j = 2. Current points 185  adding roundPoints 3  w/ futureGame undefined
  //   i = 9 j = 1. Current points 188  adding roundPoints 2  w/ futureGame 25
  //   i = 9 j = 2. Current points 190  adding roundPoints 3  w/ futureGame undefined
  //   After calculation points: 193

  const points = await getFuturePoints(futureGames, currentPoints);
  expect(points).toBe(expectedPoints);
});

//for later test
// server.test.js
// import request from 'supertest';
// import app from '../server.js'; // Adjust the path as needed

// describe('POST /updateScores', () => {
//     it('should call updateScores and return 200', async () => {
//         const response = await request(app)
//             .post('/updateScores')
//             .send({ year: 2025 }); // Adjust the payload as needed

//         expect(response.status).toBe(200);
//         expect(response.body.message).toBe("All teams scores updated successfully");
//     });
// });
