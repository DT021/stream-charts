import {default as React, useEffect, useRef} from "react";
import * as d3 from "d3";
import {ScaleBand, ScaleLinear, Selection, ZoomTransform} from "d3";
import {BarMagnifier, BarMagnifierType, LensTransformation} from "./barMagnifier";
import {TimeRange, TimeRangeType} from "./timeRange";
import {adjustedDimensions, Margin} from "./margins";
import {Datum, PixelDatum, Series} from "./datumSeries";
import {Axis} from "d3";

const defaultMargin = {top: 30, right: 20, bottom: 30, left: 50};
const defaultSpikesStyle = {
    margin: 2,
    color: '#c95d15',
    lineWidth: 2,
    highlightColor: '#d2933f',
    highlightWidth: 4
};
const defaultAxesStyle = {color: '#d2933f'};
const defaultAxesLabelFont = {
    size: 12,
    color: '#d2933f',
    weight: 300,
    family: 'sans-serif'
};
const defaultPlotGridLines = {visible: true, color: 'rgba(210,147,63,0.35)'};

/**
 * Properties for rendering the tooltip
 */
interface TooltipStyle {
    visible: boolean;

    fontSize: number;
    fontColor: string;
    fontFamily: string;
    fontWeight: number;

    backgroundColor: string;
    backgroundOpacity: number;

    borderColor: string;
    borderWidth: number;
    borderRadius: number;

    paddingLeft: number;
    paddingRight: number;
    paddingTop: number;
    paddingBottom: number;
}

const defaultTooltipStyle: TooltipStyle = {
    visible: false,

    fontSize: 12,
    fontColor: '#d2933f',
    fontFamily: 'sans-serif',
    fontWeight: 250,
    
    backgroundColor: '#202020',
    backgroundOpacity: 0.8,
    
    borderColor: '#d2933f',
    borderWidth: 1,
    borderRadius: 5,
    
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 5,
    paddingBottom: 10,
};

/**
 * Properties for rendering the line-magnifier lens
 */
interface LineMagnifierStyle {
    visible: boolean;
    width: number;
    magnification: number;
    color: string,
    lineWidth: number,
}

const defaultLineMagnifierStyle: LineMagnifierStyle = {
    visible: false,
    width: 75,
    magnification: 1,
    color: '#d2933f',
    lineWidth: 2,
};

interface TrackerStyle {
    visible: boolean;
    timeWindow: number;
    magnification: number;
    color: string,
    lineWidth: number,
}

const defaultTrackerStyle: TrackerStyle = {
    visible: false,
    timeWindow: 50,
    magnification: 1,
    color: '#d2933f',
    lineWidth: 2,
};

interface MagnifiedDatum extends Datum {
    lens: LensTransformation
}

interface Axes {
    xAxis: Axis<number | {valueOf(): number}>;
    yAxis: Axis<string>;
    xAxisSelection: AxisElementSelection;
    yAxisSelection: AxisElementSelection;
}

// the axis-element type return when calling the ".call(axis)" function
type AxisElementSelection = Selection<SVGGElement, unknown, null, undefined>;

interface Props {
    width: number;
    height: number;
    margin?: Partial<Margin>;
    spikesStyle?: Partial<{ margin: number, color: string, lineWidth: number, highlightColor: string, highlightWidth: number }>;
    axisLabelFont?: Partial<{ size: number, color: string, family: string, weight: number }>;
    axisStyle?: Partial<{ color: string }>;
    backgroundColor?: string;
    plotGridLines?: Partial<{ visible: boolean, color: string }>;
    tooltip?: Partial<TooltipStyle>;
    magnifier?: Partial<LineMagnifierStyle>;
    tracker?: Partial<TrackerStyle>;

    // data to plot: min-time is the earliest time for which to plot the data; max-time is the latest
    // and series list is a list of time-series to plot
    minTime: number;
    maxTime: number;
    seriesList: Array<Series>;
}

/**
 * Renders a raster chart
 * @param {Props} props The properties from the parent
 * @return {JSX.Element} The raster chart
 * @constructor
 */
function RasterChart(props: Props): JSX.Element {
    const {
        seriesList,
        minTime, maxTime,
        width,
        height,
        backgroundColor = '#202020',
    } = props;


    // override the defaults with the parent's properties, leaving any unset values as the default value
    const margin = {...defaultMargin, ...props.margin};
    const spikesStyle = {...defaultSpikesStyle, ...props.spikesStyle};
    const axisStyle = {...defaultAxesStyle, ...props.axisStyle};
    const axisLabelFont = {...defaultAxesLabelFont, ...props.axisLabelFont};
    const plotGridLines = {...defaultPlotGridLines, ...props.plotGridLines};
    const tooltip: TooltipStyle = {...defaultTooltipStyle, ...props.tooltip};
    const magnifier = {...defaultLineMagnifierStyle, ...props.magnifier};
    const tracker = {...defaultTrackerStyle, ...props.tracker};

    // grab the dimensions of the actual plot after removing the margins from the specified width and height
    const plotDimensions = adjustedDimensions(width, height, margin);

    // the container that holds the d3 svg element
    const containerRef = useRef<SVGSVGElement>(null);
    const mainGRef = useRef<Selection<SVGGElement, any, null, undefined>>();
    const spikesRef = useRef<Selection<SVGGElement, Series, SVGGElement, any>>();
    const magnifierRef = useRef<Selection<SVGRectElement, Datum, null, undefined>>();
    const trackerRef = useRef<Selection<SVGLineElement, Datum, null, undefined>>();

    const mouseCoordsRef = useRef<number>(0);
    const zoomFactorRef = useRef<number>(1);

    // reference to the axes for the plot
    const axesRef = useRef<Axes>();

    // unlike the magnifier, the handler forms a closure on the tooltip properties, and so if they change in this
    // component, the closed properties are unchanged. using a ref allows the properties to which the reference
    // points to change.
    const tooltipRef = useRef(tooltip);

    // calculates to the time-range based on the (min, max)-time from the props
    const timeRangeRef = useRef<TimeRangeType>(TimeRange(minTime, maxTime));

    /**
     * Called when the user uses the scroll wheel (or scroll gesture) to zoom in or out. Zooms in/out
     * at the location of the mouse when the scroll wheel or gesture was applied.
     * @param {ZoomTransform} transform The d3 zoom transformation information
     * @param {number} x The x-position of the mouse when the scroll wheel or gesture is used
     * @callback
     */
    function onZoom(transform: ZoomTransform, x: number): void {
        const time = axesRef.current!.xAxis.scale<ScaleLinear<number, number>>().invert(x);
        timeRangeRef.current = timeRangeRef.current!.scale(transform.k, time);
        zoomFactorRef.current = transform.k;
        updatePlot(timeRangeRef.current);
    }

    /**
     * Adjusts the time-range and updates the plot when the plot is dragged to the left or right
     * @param {number} deltaX The amount that the plot is dragged
     * @callback
     */
    function onPan(deltaX: number): void {
        const scale = axesRef.current!.xAxis.scale<ScaleLinear<number, number>>();
        const currentTime = timeRangeRef!.current.start;
        const x = scale(currentTime);
        const deltaTime = scale.invert(x + deltaX) - currentTime;
        timeRangeRef.current = timeRangeRef.current!.translate(-deltaTime);
        updatePlot(timeRangeRef.current);
    }

    /**
     * Renders a tooltip showing the neuron, spike time, and the spike strength when the mouse hovers over a spike.
     * @param {Datum} datum The spike datum (t ms, s mV)
     * @param {string} seriesName The name of the series (i.e. the neuron ID)
     * @param {SVGLineElement} spike The SVG line element representing the spike, over which the mouse is hovering.
     */
    function handleShowTooltip(datum: Datum, seriesName: string, spike: SVGLineElement): void {
        if(!tooltipRef.current.visible) {
            return;
        }

        // Use D3 to select element, change color and size
        d3.select<SVGLineElement, Datum>(spike)
            .attr('stroke', spikesStyle.highlightColor)
            .attr('stroke-width', spikesStyle.highlightWidth)
            .attr('stroke-linecap', "round")
        ;

        if (tooltipRef.current.visible) {
            // create the rounded rectangle for the tooltip's background
            const rect = d3.select<SVGSVGElement | null, any>(containerRef.current)
                .append<SVGRectElement>('rect')
                .attr('id', `r${datum.time}-${seriesName}`)
                .attr('class', 'tooltip')
                .attr('rx', tooltipRef.current.borderRadius)
                .attr('fill', tooltipRef.current.backgroundColor)
                .attr('fill-opacity', tooltipRef.current.backgroundOpacity)
                .attr('stroke', tooltipRef.current.borderColor)
                .attr('stroke-width', tooltipRef.current.borderWidth)
            ;

            // display the neuron ID in the tooltip
            const header = d3.select<SVGSVGElement | null, any>(containerRef.current)
                .append<SVGTextElement>("text")
                .attr('id', `tn${datum.time}-${seriesName}`)
                .attr('class', 'tooltip')
                .attr('fill', tooltipRef.current.fontColor)
                .attr('font-family', 'sans-serif')
                .attr('font-size', tooltipRef.current.fontSize)
                .attr('font-weight', tooltipRef.current.fontWeight)
                .text(() => seriesName)
            ;

            // display the time (ms) and spike strength (mV) in the tooltip
            const text = d3.select<SVGSVGElement | null, any>(containerRef.current)
                .append<SVGTextElement>("text")
                .attr('id', `t${datum.time}-${seriesName}`)
                .attr('class', 'tooltip')
                .attr('fill', tooltipRef.current.fontColor)
                .attr('font-family', 'sans-serif')
                .attr('font-size', tooltipRef.current.fontSize + 2)
                .attr('font-weight', tooltipRef.current.fontWeight + 150)
                .text(() => `${datum.time} ms, ${d3.format(".2")(datum.value)} mV`)
            ;

            // calculate the max width and height of the text
            const tooltipWidth = Math.max(header.node()?.getBBox()?.width || 0, text.node()?.getBBox()?.width || 0);
            const headerTextHeight = header.node()?.getBBox()?.height || 0;
            const idHeight = text.node()?.getBBox()?.height || 0;
            const textHeight = headerTextHeight + idHeight;

            // set the header text location
            header
                .attr('x', () => tooltipX(datum.time, tooltipWidth) + tooltipRef.current.paddingLeft)
                .attr('y', () => tooltipY(seriesName, textHeight) - idHeight + textHeight + tooltipRef.current.paddingTop)
            ;

            // set the tooltip text (i.e. neuron ID) location
            text
                .attr('x', () => tooltipX(datum.time, tooltipWidth) + tooltipRef.current.paddingLeft)
                .attr('y', () => tooltipY(seriesName, textHeight) + textHeight + tooltipRef.current.paddingTop)
            ;

            // set the position, width, and height of the tooltip rect based on the text height and width and the padding
            rect.attr('x', () => tooltipX(datum.time, tooltipWidth))
                .attr('y', () => tooltipY(seriesName, textHeight))
                .attr('width', tooltipWidth + tooltipRef.current.paddingLeft + tooltipRef.current.paddingRight)
                .attr('height', textHeight + tooltipRef.current.paddingTop + tooltipRef.current.paddingBottom)
            ;

        }
    }

    /**
     * Calculates the x-coordinate of the lower left-hand side of the tooltip rectangle (obviously without
     * "rounded corners"). Adjusts the x-coordinate so that tooltip is visible on the edges of the plot.
     * @param {number} time The spike time
     * @param {number} textWidth The width of the tooltip text
     * @return {number} The x-coordinate of the lower left-hand side of the tooltip rectangle
     */
    function tooltipX(time: number, textWidth: number): number {
        return Math
            .min(
                Math.max(
                    axesRef.current!.xAxis.scale<ScaleLinear<number, number>>()(time),
                    textWidth / 2
                ),
                plotDimensions.width - textWidth / 2
            ) + margin.left - textWidth / 2 - tooltip.paddingLeft;
    }

    /**
     * Calculates the y-coordinate of the lower-left-hand corner of the tooltip rectangle. Adjusts the y-coordinate
     * so that the tooltip is visible on the upper edge of the plot
     * @param {string} seriesName The name of the series
     * @param {number} textHeight The height of the header and neuron ID text
     * @return {number} The y-coordinate of the lower-left-hand corner of the tooltip rectangle
     */
    function tooltipY(seriesName: string, textHeight: number): number {
        const scale = axesRef.current!.yAxis.scale<ScaleBand<string>>();
        const y = (scale(seriesName) || 0) + margin.top - tooltip.paddingBottom - textHeight - tooltip.paddingTop;
        return y > 0 ? y : y + tooltip.paddingBottom + textHeight + tooltip.paddingTop + spikeLineHeight();
    }

    /**
     * @return {number} The height of the spikes line
     */
    function spikeLineHeight(): number {
        return plotDimensions.height / seriesList.length;
    }

    /**
     * Removes the tooltip when the mouse has moved away from the spike
     * @param {Datum} datum The spike datum (t ms, s mV)
     * @param {string} seriesName The name of the series (i.e. the neuron ID)
     * @param {SVGLineElement} spike The SVG line element representing the spike, over which the mouse is hovering.
     */
    function handleHideTooltip(datum: Datum, seriesName: string, spike: SVGLineElement) {
        // Use D3 to select element, change color and size
        d3.select<SVGLineElement, Datum>(spike)
            .attr('stroke', spikesStyle.color)
            .attr('stroke-width', spikesStyle.lineWidth);

        if(tooltipRef.current.visible) {
            d3.selectAll<SVGLineElement, Datum>('.tooltip').remove();
        }
    }

    /**
     * Called when the magnifier is enabled to set up the vertical bar magnifier lens
     * @param {Selection<SVGRectElement, Datum, null, undefined> | undefined} path The path selection
     * holding the magnifier whose properties need to be updated.
     * @callback
     */
    function handleShowMagnify(path: Selection<SVGRectElement, Datum, null, undefined> | undefined) {

        /**
         * Determines whether specified datum is in the time interval centered around the current
         * mouse position
         * @param {Datum} datum The datum
         * @param {number} x The x-coordinate of the current mouse position
         * @param {number} xInterval The pixel interval for which transformations are applied
         * @return {boolean} `true` if the datum is in the interval; `false` otherwise
         */
        function inMagnifier(datum: Datum, x: number, xInterval: number): boolean {
            const scale = axesRef.current!.xAxis.scale<ScaleLinear<number, number>>();
            const datumX = scale(datum.time) + margin.left;
            return datumX > x - xInterval && datumX < x + xInterval;
        }

        /**
         * Converts the datum into the x-coordinate corresponding to its time
         * @param {Datum} datum The datum
         * @return {number} The x-coordinate corresponding to its time
         */
        function xFrom(datum: Datum): number {
            const scale = axesRef.current!.xAxis.scale<ScaleLinear<number, number>>();
            return scale(datum.time);
        }

        if(containerRef.current && path) {
            const [x, y] = d3.mouse(containerRef.current);
            const isMouseInPlot = mouseInPlotArea(x, y);
            const deltaX = magnifier.width / 2;
            path
                .attr('x', x - deltaX)
                .attr('width', 2 * deltaX)
                .attr('opacity', () => isMouseInPlot ? 1 : 0)
            ;

            const svg = d3.select<SVGSVGElement, MagnifiedDatum>(containerRef.current);

            if(isMouseInPlot && Math.abs(x - mouseCoordsRef.current) >= 1) {
                const barMagnifier: BarMagnifierType = BarMagnifier(deltaX, 3 * zoomFactorRef.current, x - margin.left);
                svg
                    // select all the spikes and keep only those that are within ±4∆t of the x-position of the mouse
                    .selectAll<SVGSVGElement, MagnifiedDatum>('.spikes-lines')
                    .filter(datum => inMagnifier(datum , x, 4 * deltaX))
                    // supplement the datum with lens transformation information (new x and scale)
                    .each(datum => {datum.lens = barMagnifier.magnify(xFrom(datum))})
                    // update each spikes line with it's new x-coordinate and the magnified line-width
                    .attr('x1', datum => datum.lens.xPrime)
                    .attr('x2', datum => datum.lens.xPrime)
                    .attr('stroke-width', datum => spikesStyle.lineWidth * Math.min(2, Math.max(datum.lens.magnification, 1)))
                    .attr('shape-rendering', 'crispEdges')
                ;
                mouseCoordsRef.current = x;
            }
            else if(!isMouseInPlot) {
                svg
                    .selectAll<SVGSVGElement, Datum>('.spikes-lines')
                    .attr('x1', datum => xFrom(datum))
                    .attr('x2', datum => xFrom(datum))
                    .attr('stroke-width', spikesStyle.lineWidth)
                ;

                path
                    .attr('x', margin.left)
                    .attr('width', 0)
                ;
                mouseCoordsRef.current = 0;
            }
        }
    }

    /**
     * Callback when the mouse tracker is to be shown
     * @param {Selection<SVGLineElement, Datum, null, undefined> | undefined} path
     * @callback
     */
    function handleShowTracker(path: Selection<SVGLineElement, Datum, null, undefined> | undefined) {
        if(containerRef.current && path) {
            const [x, y] = d3.mouse(containerRef.current);
            path
                .attr('x1', x)
                .attr('x2', x)
                .attr('opacity', () => mouseInPlotArea(x, y) ? 1 : 0)
            ;
        }
    }

    /**
     * Calculates whether the mouse is in the plot-area
     * @param {number} x The x-coordinate of the mouse's position
     * @param {number} y The y-coordinate of the mouse's position
     * @return {boolean} `true` if the mouse is in the plot area; `false` if the mouse is not in the plot area
     */
    function mouseInPlotArea(x: number, y: number): boolean {
        return  x > margin.left && x < width - margin.right &&
            y > margin.top && y < height - margin.bottom;
    }

    /**
     * Updates the plot data for the specified time-range, which may have changed due to zoom or pan
     * @param {TimeRange} timeRange The current time range
     */
    function updatePlot(timeRange: TimeRangeType) {
        tooltipRef.current = tooltip;
        timeRangeRef.current = timeRange;

        if (containerRef.current) {
            // select the text elements and bind the data to them
            const svg = d3
                .select<SVGSVGElement, any>(containerRef.current)
            ;

            // set up the magnifier once
            if(magnifier.visible && magnifierRef.current === undefined) {
                const linearGradient = svg
                    .append<SVGDefsElement>('defs')
                    .append<SVGLinearGradientElement>('linearGradient')
                    .attr('id', 'magnifier-gradient')
                    .attr('x1', '0%')
                    .attr('x2', '100%')
                    .attr('y1', '0%')
                    .attr('y2', '0%')
                ;

                const borderColor = d3.rgb(tooltip.backgroundColor).brighter(3.5).hex();
                linearGradient
                    .append<SVGStopElement>('stop')
                    .attr('offset', '0%')
                    .attr('stop-color', borderColor)
                ;

                linearGradient
                    .append<SVGStopElement>('stop')
                    .attr('offset', '30%')
                    .attr('stop-color', tooltip.backgroundColor)
                    .attr('stop-opacity', 0)
                ;

                linearGradient
                    .append<SVGStopElement>('stop')
                    .attr('offset', '70%')
                    .attr('stop-color', tooltip.backgroundColor)
                    .attr('stop-opacity', 0)
                ;

                linearGradient
                    .append<SVGStopElement>('stop')
                    .attr('offset', '100%')
                    .attr('stop-color', borderColor)
                ;

                magnifierRef.current = svg
                    .append<SVGRectElement>('rect')
                    .attr('class', 'magnifier')
                    .attr('y', margin.top)
                    .attr('height', plotDimensions.height - margin.top)
                    .attr('stroke', tooltip.borderColor)
                    .attr('stroke-width', tooltip.borderWidth)
                    .style('fill', 'url(#magnifier-gradient')
                ;

                svg.on('mousemove', () => handleShowMagnify(magnifierRef.current));
            }
            // if the magnifier was defined, and is now no longer defined (i.e. props changed, then remove the magnifier)
            else if(!magnifier.visible && magnifierRef.current) {
                magnifierRef.current = undefined;
            }

            // set up the tracker-line once
            if(tracker.visible && trackerRef.current === undefined) {
                trackerRef.current = svg
                    .append<SVGLineElement>('line')
                    .attr('class', 'tracker')
                    .attr('y1', margin.top)
                    .attr('y2', plotDimensions.height)
                    .attr('stroke', tooltip.borderColor)
                    .attr('stroke-width', tooltip.borderWidth)
                    .attr('opacity', 0) as Selection<SVGLineElement, Datum, null, undefined>
                ;

                svg.on('mousemove', () => handleShowTracker(trackerRef.current));
            }
            // if the magnifier was defined, and is now no longer defined (i.e. props changed, then remove the magnifier)
            else if(!tracker.visible && trackerRef.current) {
                trackerRef.current = undefined;
            }

            // set up the main <g> container for svg and translate it based on the margins, but do it only
            // once
            if(mainGRef.current === undefined) {
                mainGRef.current = svg
                    .attr('width', width)
                    .attr('height', height)
                    .attr('color', axisStyle.color)
                    .append<SVGGElement>('g')
                ;
            }
            else {
                spikesRef.current = mainGRef.current!
                    .selectAll<SVGGElement, Series>('g')
                    .data<Series>(seriesList)
                    .enter()
                    .append('g')
                    .attr('class', 'spikes-series')
                    .attr('id', series => series.name)
                    .attr('transform', `translate(${margin.left}, ${margin.top})`);
            }

            // set up panning
            const drag = d3.drag<SVGSVGElement, Datum>()
                .on("start", () => d3.select(containerRef.current).style("cursor", "move"))
                .on("drag", () => onPan(d3.event.dx))
                .on("end", () => d3.select(containerRef.current).style("cursor", "auto"))
            ;

            svg.call(drag);

            // set up for zooming
            const zoom = d3.zoom<SVGSVGElement, Datum>()
                .scaleExtent([0, 10])
                .translateExtent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]])
                .on("zoom", () => {
                    console.log(d3.event);
                    onZoom(d3.event.transform, d3.event.sourceEvent.offsetX -  margin.left);
                })
            ;

            svg.call(zoom);

            // calculate the mapping between the times in the data (domain) and the display
            // location on the screen (range)
            // const maxTime = calcMaxTime(seriesList);
            const xScale = d3.scaleLinear()
                // .domain([Math.max(0, maxTime - timeWindow), Math.max(timeWindow, maxTime)])
                .domain([timeRangeRef.current.start, timeRangeRef.current.end])
                .range([0, plotDimensions.width]);

            // const lineHeight = height / seriesList.length;
            const lineHeight = spikeLineHeight();
            const yScale = d3.scaleBand()
                .domain(seriesList.map(series => series.name))
                .range([0, lineHeight * seriesList.length - margin.top]);

            // create and add the axes, grid-lines, and mouse-over functions
            if (!axesRef.current) {
                const xAxis = d3.axisBottom(xScale);
                const yAxis = d3.axisLeft(yScale);
                const xAxisSelection = svg
                    .append<SVGGElement>('g')
                    .attr('class', 'x-axis')
                    .attr('transform', `translate(${margin.left}, ${plotDimensions.height})`)
                    .call(xAxis);

                const yAxisSelection = svg
                    .append<SVGGElement>('g')
                    .attr('class', 'y-axis')
                    .attr('transform', `translate(${margin.left}, ${margin.top})`)
                    .call(yAxis);

                axesRef.current = {
                    xAxis: xAxis,
                    yAxis: yAxis,
                    xAxisSelection: xAxisSelection,
                    yAxisSelection: yAxisSelection
                };

                svg
                    .append<SVGTextElement>('text')
                    .attr('text-anchor', 'middle')
                    .attr('font-size', axisLabelFont.size)
                    .attr('fill', axisLabelFont.color)
                    .attr('font-family', axisLabelFont.family)
                    .attr('font-weight', axisLabelFont.weight)
                    .attr('transform', `translate(${margin.left + plotDimensions.width / 2}, ${plotDimensions.height + margin.top + (margin.bottom / 3)})`)
                    .text("t (ms)");

                if (plotGridLines.visible) {
                    const gridLines = svg
                        .select<SVGGElement>('g')
                        .selectAll('grid-line')
                        .data(seriesList.map(series => series.name));

                    gridLines
                        .enter()
                        .append<SVGLineElement>('line')
                        .attr('x1', margin.left)
                        .attr('x2', margin.left + plotDimensions.width)
                        .attr('y1', d => (yScale(d) || 0) + margin.top + lineHeight / 2)
                        .attr('y2', d => (yScale(d) || 0) + margin.top + lineHeight / 2)
                        .attr('stroke', plotGridLines.color)
                    ;
                }

            }
            // update the scales
            else {
                axesRef.current.xAxis = d3.axisBottom(xScale);
                axesRef.current.xAxisSelection.call(axesRef.current.xAxis);
                axesRef.current.yAxis = d3.axisLeft(yScale);
                axesRef.current.yAxisSelection.call(axesRef.current.yAxis);
            }

            seriesList.forEach(series => {
                const container = svg
                    .select<SVGGElement>(`#${series.name}`)
                    .selectAll<SVGLineElement, PixelDatum>('line')
                    .data(series.data.filter(datum => datum.time >= timeRangeRef.current.start && datum.time <= timeRangeRef.current.end) as PixelDatum[])
                ;

                // enter new elements
                const y = (yScale(series.name) || 0);
                container
                    .enter()
                    .append<SVGLineElement>('line')
                    .filter(datum => datum.time >= timeRangeRef.current.start)
                    .each(datum => {datum.x = xScale(datum.time)})
                    .attr('class', 'spikes-lines')
                    .attr('x1', datum => datum.x)
                    .attr('x2', datum => datum.x)
                    .attr('y1', _ => y + spikesStyle.margin)
                    .attr('y2', _ => y + lineHeight - spikesStyle.margin)
                    .attr('stroke', spikesStyle.color)
                    .attr('stroke-width', spikesStyle.lineWidth)
                    .attr('stroke-linecap', "round")
                    // even though the tooltip is may not be set to show up on the mouseover, we want to attach the handler
                    // so that when the use enables tooltips the handlers will show the the tooltip
                    .on("mouseover", (datum, i, group) => handleShowTooltip(datum, series.name, group[i]))
                    .on("mouseleave", (datum, i, group) => handleHideTooltip(datum, series.name, group[i]))
                ;

                // update existing elements
                container
                    .filter(datum => datum.time >= timeRangeRef.current.start)
                    .each(datum => {datum.x = xScale(datum.time)})
                    .attr('x1', datum => datum.x)
                    .attr('x2', datum => datum.x)
                    .attr('y1', _ => y + spikesStyle.margin)
                    .attr('y2', _ => y + lineHeight - spikesStyle.margin)
                ;

                // exit old elements
                container.exit().remove()
                ;
            });
        }
    }

    // called when:
    // 1. component mounts to set up the main <g> element and a <g> element for each series
    //    into which d3 renders the series
    // 2. series data changes
    // 3. time-window changes
    // 4. plot attributes change
    useEffect(
        () => {
            const timeRange = timeRangeRef.current.matchesOriginal(minTime, maxTime) ? timeRangeRef.current : TimeRange(minTime, maxTime);
            updatePlot(timeRange);
        }
    );

    return (
        <svg
            className="streaming-raster-chart-d3"
            width={width}
            height={height * seriesList.length}
            style={{backgroundColor: backgroundColor}}
            ref={containerRef}
        />
    );
}

// /**
//  * Calculates the maximum time found in the specified list of time-series
//  * @param {Array<Series>} seriesList An array of time-series
//  * @return {number} The maximum time
//  */
// export function calcMaxTime(seriesList: Array<Series>): number {
//     return d3.max(seriesList.map(series => series.last().map(datum => datum.time).getOrElse(0))) || 0;
// }

export default RasterChart;