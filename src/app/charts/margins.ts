/**
 * Margin information
 */
export interface Margin {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

/**
 * Given the overall dimensions of the plot (width, height) and the margins, calculates the dimensions
 * of the actual plot by subtracting the margins.
 * @param {number} width The overall width (plot and margins)
 * @param {number} height The overall height (plot and margins)
 * @param {Margin} margins The margins around the plot (top, bottom, left, right)
 * @return {{width: number, height: number}} The dimensions of the actual plots adjusted for the margins
 * from the overall dimensions
 */
export function adjustedDimensions(width: number, height: number, margins: Margin): { width: number, height: number } {
    return {
        width: width - margins.left - margins.right,
        height: height - margins.top - margins.bottom
    };
}

