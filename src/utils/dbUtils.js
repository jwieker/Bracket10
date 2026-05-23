// Consolidated retryOperation helper
export const retryOperation = async (
  operation,
  maxRetries = 5,
  delayMs = 1000
) => {
  let currentDelay = delayMs;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, currentDelay));
        currentDelay *= 2; // exponential backoff
      } else {
        throw error;
      }
    }
  }
};
