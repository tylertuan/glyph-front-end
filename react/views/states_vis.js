import * as A from 'antd'
import React from 'react'
import ReactDOM from 'react-dom'
import * as RR from 'react-redux'
import * as Redux from '../../redux'
import { Flex, Box } from 'reflexbox'
import * as d3 from 'd3'
import * as _ from 'lodash'
import ReactJson from 'react-json-view'

let mapStateToProps = (state) => {
  return { store: state }
}

let mapDispatchToProps = (dispatch) => {
  return { dispatch }
}

class StatesVisRaw extends React.Component {
  componentWillReceiveProps(nextProps) {
    if (this.props.store.view.updateTime !== nextProps.store.view.updateTime) {
      console.log('update for states')
      setTimeout(() => this._redrawHighlights(nextProps), 200)
    }
  }

  componentDidMount() {
    var width = this.divElement.clientWidth
    var height = this.props.store.app.visHeight/2
    var margin = 20

    var svg = d3.select('#state')
      .attr('width', width)
      .attr('height', height)

    var g = svg.append('g').classed('d3-points', true)

    var nodes = this.props.store.view.dataset.nodes
    var links = this.props.store.view.dataset.links

    var incomingMap = {}
    var outcomingMap = {}

    var nodesMap = _.chain(nodes).map(n => [n.id, n]).fromPairs().value()

    nodes.forEach(n => {
      n.state_type = n.type || n.state_type
      n.visits = n.visits || n.user_ids.length
    })

    links.forEach((l) => {
      l.weight = l.weight || l.user_ids.length
      l.target = l.target_id || l.target
      l.source = l.source_id || l.source

      if (!incomingMap[l.target]) incomingMap[l.target] = []
      if (!outcomingMap[l.source]) outcomingMap[l.source] = []

      incomingMap[l.target].push(l.source)
      outcomingMap[l.source].push(l.target)
    })

    var statesAsEndPoints = _.chain(outcomingMap).toPairs()
    .filter(p => nodesMap[p[0]].state_type === 'mid')
    .map(p => {
      var [source, targets] = p

      var outUids = _.chain(targets)
        .map(t => nodesMap[t].user_ids)
        .flatten().uniq().value()

      var inUids = _.uniq(nodesMap[source].user_ids)
      var endUids = _.difference(inUids, outUids)

      return [source, endUids]
    }).fromPairs().value()

    nodes.forEach((d) => {
      if (!outcomingMap[d.id] && d.state_type === 'mid') {
        outcomingMap[d.id] = ['-1']
        statesAsEndPoints[d.id] = d.user_ids
      }
    })

    var quitNode = {
      id: '-1',
      user_ids: _.chain(statesAsEndPoints).values().flatten().uniq().value(),
      visits: (_.chain(statesAsEndPoints).values().flatten().uniq().value()).length,
      state_type: 'end-quit'
    }

    nodes.push(quitNode)
    nodesMap['-1'] = quitNode
    outcomingMap['-1'] = []
    incomingMap['-1'] = _.keys(_.omitBy(statesAsEndPoints, v => !v.length))

    links = links.concat(_.toPairs(statesAsEndPoints).map(p => {
      var [sourceId, uids] = p

      return {
        id: sourceId + '_-1',
        source: sourceId,
        source_id: sourceId,
        target: '-1',
        target_id: '-1',
        user_ids: uids,
        weight: uids.length
      }
    }).filter(l => l.weight > 1))

    var simplePathsIndex = {}

    links.forEach((l) => {
      var originalLink = _.cloneDeep(l)
      var { source, target } = l

      l.midPoints = []

      while (true) {
        if (nodesMap[source].state_type !== 'mid')
          break

        if (outcomingMap[source].length > 1 || incomingMap[source].length > 1)
          break

        l.midPoints.push(nodesMap[source])
        source = incomingMap[source][0]
      }

      while (true) {
        if (nodesMap[target].state_type !== 'mid')
          break

        if (outcomingMap[target].length > 1 || incomingMap[target].length > 1)
          break

        l.midPoints.push(nodesMap[target])
        target = outcomingMap[target][0]
      }

      l.source = source
      l.target = target

      var simplePathKey = [source, target].join(':')

      if (simplePathsIndex[simplePathKey]) {
        simplePathsIndex[simplePathKey].push(originalLink)
      } else {
        simplePathsIndex[simplePathKey] = [originalLink]
      }
    })

    // this._setStuckNodes(null, nodes, nodesMap, outcomingMap)

    var computeResidualQuitNodes = function() {
      var endStatesUsers = _.chain(nodes).filter(n => n.state_type !== 'mid' && n.state_type !== 'start')
            .map(n => n.user_ids).flatten().reduce((obj, v) => _.set(obj, v, true), {}).value()

      nodes.forEach(n => {
        n.user_ids.forEach(pid => {
          if (endStatesUsers[pid]) n.found = true
        })
      })

      nodes.forEach(n => {
        if (!n.found && n.state_type === 'mid') {
          nodesMap['-1'].user_ids = _.union(nodesMap['-1'].user_ids, n.user_ids)

          links.push({
            id: n.id + '_-1',
            source: n.id,
            source_id: n.id,
            target: '-1',
            target_id: '-1',
            user_ids: n.user_ids,
            weight: n.user_ids.length,
            midPoints: []
          })
        }
      })
    }

    computeResidualQuitNodes()

    var scales = {
      x: d3.scaleLinear().domain(d3.extent(nodes.map((d) => d.distance_start))).range([margin, width - margin]),
      y: d3.scaleLinear().domain(d3.extent(nodes.map((d) => parseInt(d.id)))).range([margin, height - margin]),
      z: d3.scaleLinear().domain(d3.extent(nodes.map((d) => d.user_ids.length))).range([3, 20])
    }

    var link = g.selectAll('.d3-link')
                    .data(links)

    link = link.enter().append('line')
        .classed('d3-link', true)

    link
      .attr('stroke-width', l => 2*Math.sqrt(l.weight))
      .attr('stroke', l => l.midPoints.length === 0 ? (l.source < l.target ? '#94a3b6' : '#a3b694') : '#c7c00d' )
      .attr('opacity', l => 0.2/(l.midPoints.length + 1))


    var point = g.selectAll('.d3-point')
                    .data(nodes)

    point = point.enter().append('circle')
        .classed('d3-point', true)

    point
        // .attr('cx', (d) => scales.x(d.distance_start) )
        // .attr('cy', (d) => scales.y(parseInt(d.id)) )
        .attr('r', (d) => 2*Math.sqrt(d.visits))
        .attr('opacity', 0.25)
        .attr('fill', (d) => {
          return ({
            start: 'blue',
            end: 'green',
            'end-quit': 'red'
          })[d.state_type] || (d.found ? 'grey' : 'red')
        })

    var x = (x) => x < 3*margin ? 3*margin : Math.min(width - 3*margin, x)
    var y = (y) => y < 2*margin ? 2*margin : Math.min(height - 2*margin, y)

    var usersCount = _.chain(nodes).map(d => d.user_ids).flatten().uniq().value().length * 1.0
    var endNodesBySignificance = _.chain(nodes).filter(d => d.state_type === 'end')
          .map((d) => [d.id, d.user_ids.length/usersCount > 0.1 ? true : false])
          .fromPairs()
          .value()

    var simulation = d3.forceSimulation(nodes)
            .force('charge', d3.forceManyBody())
            .force('link', d3.forceLink(links).id((d) => d.id).distance(width*height*1.0/links.length/5).strength(1))
            .force('collide', d3.forceCollide(d => 2*Math.sqrt(d.visits)).iterations(2))
            // .force('collision', d3.forceCollide().radius((d) => {
            //   return (['start', 'end', 'end-quit'].indexOf(d.state_type) > -1) ? 40 : 5
            // }).strength(1))
            .on('tick', () => {
              point
                .each((d) => {
                  switch (d.state_type) {
                    case 'start':
                      d.fx = margin
                      d.fy = margin
                      break
                    case 'end-quit':
                      d.fx = width - margin
                      d.fy = height - margin
                      break
                    case 'end':
                      // if (x(d.x)*1.0/width > 0.75*y(d.y)/height) {
                      if (endNodesBySignificance[d.id]) {
                        d.y = height - margin
                        d.x = x(d.x)
                      } else {
                        d.x = width - margin
                        d.y = y(d.y)
                      }
                      break
                    default:
                      d.x = x(d.x)
                      d.y = y(d.y)
                  }
                })

              // link.each(l => {
              //   var scale = 50.0/Math.sqrt(Math.pow(l.source.x - l.target.x, 2) + Math.pow(l.source.y - l.target.y, 2) + 1)
              //
              //   // if (l.source.x && l.source.y && l.target.x && l.target.y && !scale)
              //   //   console.log(l.source.x, l.source.y, l.target.x, l.target.y, scale)
              //
              //   if (l.target.state_type === 'end-quit')
              //     scale = scale*3
              //
              //   if (l.source.state_type !== 'mid') {
              //     l.target.x = l.source.x + scale*(l.target.x - l.source.x)
              //     l.target.y = l.source.y + scale*(l.target.y - l.source.y)
              //   }
              //
              //   if(l.target.state_type !== 'mid') {
              //     l.source.x = l.target.x + scale*(l.source.x - l.target.x)
              //     l.source.y = l.target.y + scale*(l.source.y - l.target.y)
              //   }
              //
              //   // console.log(l)
              // })

              link.attr('x1', (d) => this._getShiftLinkAtSource(d).x )
                  .attr('x2', (d) => d.target.x )
                  .attr('y1', (d) => this._getShiftLinkAtSource(d).y )
                  .attr('y2', (d) => d.target.y )

              point
                .attr('cx', (d) => d.x)
                .attr('cy', (d) => d.y)
            })

    point.call(d3.drag()
      .on('start', (d) => {
        if (!d3.event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d3.event.x
        d.fy = d3.event.y
      })
      .on('drag', (d) => {
        d.fx = d3.event.x
        d.fy = d3.event.y
      })
      .on('end', (d) => {
        if (!d3.event.active) simulation.alphaTarget(0)
        d.fx = d3.event.x
        d.fy = d3.event.y
      })
    )

    point
      .on('mouseover', (node) => { this._onNodesSelection([node], true) })
      .on('mouseout', (node) => { this._onNodesSelection([node], false) })
      .on('click', (node) => { this._onNodesSelection([node], true, true) })
      .on('dblclick', (node) => { this._onNodesSelection([node], false, true) })

    link
      .on('mouseover', (l) => { this._onNodesSelection([l.source].concat(l.midPoints).concat([l.target]), true) })
      .on('mouseout', (l) => { this._onNodesSelection([l.source].concat(l.midPoints).concat([l.target]), false) })
      .on('click', (l) => { this._onNodesSelection([l.source].concat(l.midPoints).concat([l.target]), true, true) })
      .on('dblclick', (l) => { this._onNodesSelection([l.source].concat(l.midPoints).concat([l.target]), false, true) })

    this.point = point
    this.link = link
  }

  // _setStuckNodes(node, nodes, nodesMap, outcomingMap, nodesPathVisited) {
  //   var startNode = node
  //   var path = nodesPathVisited || {}
  //
  //   if (!startNode)
  //     nodes.forEach(n => { if (n.state_type === 'start') startNode = n })
  //   else {
  //     if (startNode.state_type === 'end' || startNode.state_type === 'end-quit') {
  //       _.keys(path).forEach(nid => { nodesMap[nid].found = true })
  //       return
  //     }
  //   }
  //
  //   path[startNode.id] = true
  //
  //   var continues = outcomingMap[startNode.id].filter(nid => !path[nid])
  //
  //   continues.forEach(nid => {
  //     if (nodesMap[nid].found) {
  //       nodesMap[startNode.id].found = true
  //     } else {
  //       this._setStuckNodes(nodesMap[nid], nodes, nodesMap, outcomingMap, path)
  //     }
  //   })
  //
  //   delete path[startNode.id]
  //
  //   if (!node) {
  //
  //   }
  //
  //   if (!node) {
  //     nodes.forEach(nid => {(outcomingMap[nid] || []).forEach(toNid => {if (nodesMap[toNid].found) nodesMap[nid].found = true})})
  //     _.reverse(nodes).forEach(nid => {(outcomingMap[nid] || []).forEach(toNid => {if (nodesMap[toNid].found) nodesMap[nid].found = true})})
  //   }
  // }

  _getShiftLinkAtSource(l, checkProps) {
    var selection = this.props.store.view.selection

    var { x, y } = l.source
    var sourceRadius = selection.nodes.size === 0 ? 2*Math.sqrt(l.source.visits) : 2*Math.sqrt(_.intersection(_.keys(selection.users).map(i=>parseInt(i)), l.source.user_ids).length)
    var edgeWidth = 2*Math.sqrt(l.weight)

    if (selection.nodes.size > 0) {
      var intersectedUids = _.reduce(
        l.midPoints.map(d => d.user_ids).concat([l.source.user_ids, l.target.user_ids]),
        (res, uids) => { return _.intersection(res, uids) },
        _.keys(selection.users).map(i=>parseInt(i))
      )

      edgeWidth = 2*Math.sqrt(intersectedUids.length ? intersectedUids.length + 2 : 0)
    }

    var dx = l.target.x - x
    var dy = l.target.y - y

    // orthoginal vector
    var dyP = dx/(Math.sqrt(dx*dx + dy*dy) + 0.01)
    var dxP = -dyP*dy/(dx + 0.01)

    var shiftLength = l.midPoints.length > 0 ? sourceRadius : edgeWidth

    return {
      x: x + shiftLength*dxP,
      y: y + shiftLength*dyP
    }
  }

  _onNodesSelection(nodes, isOn, isClicked) {
    this.props.dispatch({
      type: Redux.SELECT_NODES,
      data: { nodes, isOn, isClicked }
    })
  }

  _redrawHighlights() {
    var selection = this.props.store.view.selection

    this.point
      .transition().duration(500).ease(d3.easePoly.exponent(2))
      .attr('r', (d) => {
        if (selection.nodes.size === 0) return 2*Math.sqrt(d.visits)

        return selection.pathNodes.has(d.id) ? 2*Math.sqrt(_.intersection(_.keys(selection.users).map(i=>parseInt(i)), d.user_ids).length) : 0
      })
      .attr('stroke-width', (d) => {
        return (selection.nodes.has(d.id) || selection.pathNodes.has(d.id)) ? 2 : 0
      })
      .attr('stroke', (d) => {
        return selection.nodes.has(d.id) ? 'yellow' : (
          selection.pathNodes.has(d.id) ? 'purple' : 'black'
        )
      })
      .attr('opacity', (d) => {
        if (selection.nodes.size === 0) return 0.25

        return (selection.pathNodes.has(d.id))
          ? 1 : 0.025
      })

    this.link
      .transition().duration(500).ease(d3.easePoly.exponent(2))
      .attr('x1', (d) => this._getShiftLinkAtSource(d).x )
      .attr('x2', (d) => d.target.x )
      .attr('y1', (d) => this._getShiftLinkAtSource(d).y )
      .attr('y2', (d) => d.target.y )

      .attr('opacity', (l) => {
        if (selection.nodes.size === 0) return 0.2/(l.midPoints.length + 1)

        return (
          (selection.pathNodes.has(l.source.id) && selection.pathNodes.has(l.target.id))
            ? 0.5 : 0.025
          )/(l.midPoints.length + 1)
      })
      .attr('stroke-width', (l) => {
        if (
          selection.users.length > 0 && _.chain(selection.users).intersection(l.target.user_ids).intersection(l.source.user_ids).uniq().value().length === 0
        ) return 0

        if (selection.nodes.size === 0) return 2*Math.sqrt(l.weight)

        var intersectedUids = _.reduce(
          l.midPoints.map(d => d.user_ids).concat([l.source.user_ids, l.target.user_ids]),
          (res, uids) => { return _.intersection(res, uids) },
          _.keys(selection.users).map(i=>parseInt(i))
        )

        return 2*Math.sqrt(intersectedUids.length ? intersectedUids.length + 2 : 0)
      })
  }

  render() {
    return (
      <div ref={ (divElement) => this.divElement = divElement}>
        <svg id='state'>
          <defs>
            <linearGradient id='edge' x1='0' y1='0' x2='100%' y2='100%'>
                <stop stopColor='grey' offset='0' />
                <stop stopColor='yellow' offset='100%' />
            </linearGradient>
            <linearGradient id='path' x1='0' y1='0' x2='100%' y2='100%'>
                <stop stopColor='purple' offset='0' />
                <stop stopColor='yellow' offset='100%' />
            </linearGradient>
          </defs>
        </svg>
      </div>
    )
  }
}

export var StatesVis = RR.connect(mapStateToProps, mapDispatchToProps)(StatesVisRaw)
