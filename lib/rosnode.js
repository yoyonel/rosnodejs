var http        = require('http')
  , net         = require('net')
  , url         = require('url')
  , xmlrpc      = require('xmlrpc')
  , ctype       = require('ctype')
  , portscanner = require('portscanner')
  , ros         = require('./ros')
  , master      = require('./master')


/////////////////////////////////////////////////////////////////////////////
// ros.Node
/////////////////////////////////////////////////////////////////////////////

ros.Node.prototype.save = function(attributes, options) {
  var that = this

  var uri = {
    protocol: 'http'
  , hostname: 'localhost'
  }
  portscanner.findAPortNotInUse(9000, 9050, uri.hostname, function(error, port) {
    console.log('PORT NOT IN USE: ' + port)
    uri.port = port
    that.set({ uri: uri })
    that.server = that.createSlaveServer(uri)
    options.success()
  })
}

ros.Node.prototype.sync = function(method, model, options) {
  options.success()
}

ros.Node.prototype.createSlaveServer = function(uri) {
  var that = this

  var server = xmlrpc.createServer(uri)
  server.on('publisherUpdate', function(error, params, callback) {
    var callerId   = params[0]
      , topicName  = params[1]
      , publishers = params[2]

    if (topicName.length > 0 && topicName.charAt(0) === '/') {
      topicName = topicName.substr(1, topicName.length - 1)
    }

    var subscriber = that.subscribers.get(topicName)
    subscriber.publisherUpdate(publishers, function (error) {
      callback(error)
    })
  })

  server.on('requestTopic', function(error, params, callback) {
    var callerId  = params[0]
      , topicName = params[1]
      , protocols = params[2]

    if (topicName.length > 0 && topicName.charAt(0) === '/') {
      topicName = topicName.substr(1, topicName.length - 1)
    }

    var publisher = that.publishers.get(topicName)
    publisher.selectProtocol(protocols, function (error, protocolParams) {
      callback(error, protocolParams)
    })
  })
}


/////////////////////////////////////////////////////////////////////////////
// ros.Publisher
/////////////////////////////////////////////////////////////////////////////

ros.Publisher.prototype.save = function(attributes, options) {
  var that = this

  var nodeId    = this.get('nodeId')
    , node      = ros.nodes.get(nodeId)
    , nodeUri   = node.get('uri')
    , callerUri = url.format(nodeUri)
    , topic     = this.get('topic')

  master.registerPublisher(nodeId, callerUri, topic, function(error, value) {
    if (error !== null) {
      options.error(error)
    }
    else {
      portscanner.findAPortNotInUse(9000, 9050, null, function(error, port) {
        var uri = {
          protocol: 'http'
        , hostname: 'localhost'
        , port: port
        }
        that.set({ uri: uri })
        that.server = net.createServer(function(socket) {
          socket.on('data', function(data) {

          })
          that.socket = socket
        })
        that.server.listen(port)
        options.success()
      })
    }
  })
}

ros.Publisher.prototype.sync = function(method, model, options) {
  options.success()
}

ros.Publisher.prototype.publish = function(message, callback) {
  if (this.socket) {
    this.socket.write(JSON.stringify(message))
  }
}

ros.Publisher.prototype.selectProtocol = function(protocols, callback) {
  var uri          = this.get('uri')
    , formattedUri = url.format(uri)
  callback(null, [1, 'ready on ' + formattedUri, ['TCPROS', uri.hostname, uri.port]])
}


/////////////////////////////////////////////////////////////////////////////
// ros.Subscriber
/////////////////////////////////////////////////////////////////////////////

ros.Subscriber.prototype.save = function(attributes, options) {
  var nodeId    = this.get('nodeId')
    , node      = ros.nodes.get(nodeId)
    , nodeUri   = node.get('uri')
    , callerUri = url.format(nodeUri)
    , topic     = this.get('topic')

  master.registerSubscriber(nodeId, callerUri, topic, function(error, value) {
    if (error !== null) {
      options.error(error)
    }
    else {
      options.success()
    }
  })
}

ros.Subscriber.prototype.sync = function(method, model, options) {
  options.success()
}

ros.Subscriber.prototype.publisherUpdate = function(publishers, callback) {
  var that = this

  var callerId  = '/' + this.get('nodeId')
    , topic     = this.get('topic')
    , topicName = topic.get('name')

  for (var i = 0; i < publishers.length; i++) {
    var uriString = publishers[i]
    var uri = url.parse(uriString)
    uri.path = '/'

    var client = xmlrpc.createClient( { host: uri.hostname, port: uri.port, path: uri.path })
    client.call('requestTopic', [callerId, topicName, [['TCPROS']]], function(error, value) {
      var hostParams = value[2]
        , host       = hostParams[1]
        , port       = hostParams[2]
        , options    = { host: host, port: port }

      var headers = []
      headers.push({ key: 'callerid', value: callerId })
      headers.push({ key: 'topic', value: '/' + topicName })
      headers.push({ key: 'md5sum', value: '992ce8a1687cec8c8bd883ec73ca41d1' })
      headers.push({ key: 'type', value: 'std_msgs/String' })

      var totalHeaderLength = 0
      for (var i = 0; i < headers.length; i++) {
        totalHeaderLength += headers[i].key.length
        totalHeaderLength += headers[i].value.length
        totalHeaderLength += 5
      }

      var bufferOffset = 0
        , buffer       = new Buffer(totalHeaderLength + 4)
      ctype.wuint32(totalHeaderLength, 'little', buffer, bufferOffset)
      bufferOffset += 4
      for (var j = 0; j < headers.length; j++) {
        var headerKeyValue = headers[j].key + '=' + headers[j].value
        ctype.wuint32(headerKeyValue.length, 'little', buffer, bufferOffset)
        bufferOffset += 4
        bufferOffset += buffer.write(headerKeyValue, bufferOffset, 'ascii')
      }

      var socket = net.createConnection(port, host) 
      socket.on('data', function(data) {
        var topic       = that.get('topic')
          , messageType = topic.get('type')
        that.trigger('message', '' + data)
      })

      socket.write(buffer)
    })
  }
  callback(null)
}

module.exports = ros
