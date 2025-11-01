export interface IReviewProvider {
  /**
   * Generate a review markdown string given the changed files and commit range.
   */
  generateReview(
    files: string[],
    oldHash: string,
    newHash: string
  ): Promise<string>;
}
