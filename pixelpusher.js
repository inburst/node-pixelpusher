//******************************************************************************
// Heroic Robotics Pixel Pusher Nodejs Library
// Aaron Jones <aaron@inburst.io>
//******************************************************************************

var buffertools = require('buffertools'),
    dgram       = require('dgram'),
    Emitter     = require('events').EventEmitter,
    util        = require('util');

var Pixel      = require('./pixel');
var PixelStrip = require('./pixelstrip');


var LISTENER_SOCKET_PORT = 7331;
var CONTROLLER_TIMEOUT_THRESHOLD_MILLIS = 5000;
var TIMEOUT_CHECK_MILLIS = 1000;

var PixelPusher = function(options) {
    var that = this;

    if (!(that instanceof PixelPusher)) return new PixelPusher(options);
    that.options = options;
    that.controllers = {};

    //create a datagram socket listener and
    dgram.createSocket('udp4').on('message', function(message, rinfo) {
        var controller,
            cycleTime,
            delta,
            mac,
            params;

        // confirm proper message length
        if (message.length < 48) return console.log('message too short (' + message.length + ' octets)');

        // aquire device mac address
        mac = message.slice(0, 6).toString('hex').match(/.{2}/g).join(':');

        // if we have already connected with this controller
        // do some processing but dont create a new controller reference
        if (!!that.controllers[mac]) {
            // grab a reference to the controller instance
            controller = that.controllers[mac];
            // insure proper device type from message (looking for '2')
            if (controller.params.deviceType !== 2) return;

            // capture the cycle time presented in the message and convert to sec
            // starts at position 28.
            cycleTime = message.readUInt32LE(28) / 1000;
            // and the delta
            delta = message.readUInt32LE(36);


            if (delta > 5) {
                // if there was a long delta period trim
                // any build up of messages off the queue
                cycleTime += 5;
                controller.trimStaleMessages(controller);
            } else if ((delta === 0) && (cycleTime > 1)) {
                cycleTime -= 1;
            }

            controller.params.pixelpusher.updatePeriod = cycleTime;
            controller.params.pixelpusher.powerTotal = message.readUInt32LE(32);
            controller.params.pixelpusher.deltaSequence = delta;
            controller.lastUpdated = new Date().getTime();
            controller.nextUpdate = controller.lastUpdated + cycleTime;

            if (!!controller.timer) {
                clearTimeout(controller.timer);
                controller.sync(controller);
            }
            return controller.emit('update');
        }


        // this is a newly discovered controller
        var ipAddress = message
                            .slice(6, 10).toString('hex').match(/.{2}/g)
                            .map(function(x) { return parseInt(x, 16); }).join('.');
        console.log('PixelPusher discovered at ip address ['+ipAddress+']');

        params = {
            macAddress   : mac,
            ipAddress    : ipAddress,
            deviceType   : message[10],
            protocolVrsn : message[11],
            vendorID     : message.readUInt16LE(12),
            productID    : message.readUInt16LE(14),
            hardwareRev  : message.readUInt16LE(16),
            softwareRev  : message.readUInt16LE(18),
            linkSpeed    : message.readUInt32LE(20),
            socket       : this
        };
        // if the device type specified does not
        // match PP expected then simply stick the message
        // in a payload parameter which can be later read
        if (params.deviceType !== 2) {
            params.payload = message.slice(24).toString('hex');
        } else {
            // read the pixel pusher configuration from the inbound message
            // the indicies are buffer positions of the coorisponding values
            params.pixelpusher = {
                numberStrips   : message[24],
                stripsPerPkt   : message[25],
                pixelsPerStrip : message.readUInt16LE(26),
                updatePeriod   : message.readUInt32LE(28) / 1000,
                powerTotal     : message.readUInt32LE(32),
                deltaSequence  : message.readUInt32LE(36),
                controllerNo   : message.readInt32LE(40),
                groupNo        : message.readInt32LE(44),
            };

            // if the message is long enough to contain the extra parameters
            // assume them and store.
            if (message.length >= 54) {
                params.pixelpusher.artnetUniverse   = message.readUInt16LE(48);
                params.pixelpusher.artnetChannel    = message.readUInt16LE(50);
                params.pixelpusher.myPort           = message.readUInt16LE(52);
            } else {
                // otherwise it is just the port that was sent.
                params.pixelpusher.myPort = 9761;
            }

            // again if the message is long engough assume the following parameters
            if (message.length >= 62) {
                params.pixelpusher.stripFlags = message
                                                    .slice(54, 62).toString('hex').match(/.{2}/g)
                                                    .map(function(x) { return parseInt(x, 16); });
            }

            // final flags on the tail of the message
            if (message.length >= 66) {
                params.pixelpusher.pusherFlags      =   message.readInt32LE(62);
            }
        }
        // build the controller object and keep a hash lookup of it
        // by mac address so we can locate it on future messages
        var newController = new Controller(params);
        that.controllers[mac] = newController;
        // emit to any listeners that we have discovered a new controller
        that.emit('discover', newController);
    }).on('listening', function() {
        // log that the socket listener has begun listening
        console.log('Socket listening for pixel pusher on udp://*:' + this.address().port);
    }).on('error', function(err) {
        console.log('Error opening socket to detect PixelPusher', err);
        that.emit('error', err);
    }).bind(LISTENER_SOCKET_PORT);

    setInterval(function() {
        var controller = null,
            mac = null;
        var now = new Date().getTime();

        for (mac in that.controllers) {
            // grab a reference to the controller
            controller = that.controllers[mac];

            // if this controller is empty skip it.
            if (!controller) {
                // clear it from the controller cache so we dont need
                // to look at it again.
                delete that.controllers[mac];
                continue;
            }

            // if this controller was updated in the last threshold then
            // continue. otherwise consider the controller as timed out
            if ((controller.lastUpdated + CONTROLLER_TIMEOUT_THRESHOLD_MILLIS) < now){
                //inform listeners that the controller has timed out
                controller.emit('timeout');
                // incase there is any timer set clear it.
                if (!!controller.timer) clearTimeout(controller.timer);
                // remove the controller ref from our local cache
                delete(that.controllers[mac]);
            }
        }
    }, TIMEOUT_CHECK_MILLIS);
};

// build the PP obj to contain the necessary EventEmitter methods
util.inherits(PixelPusher, Emitter);

var Controller = function(params) {
    var i;
    var that = this;

    if (!(that instanceof Controller)) return new Controller(params);

    that.params = params;

    that.lastUpdated = new Date().getTime();
    that.nextUpdate = that.lastUpdated + that.params.pixelpusher.updatePeriod;

    that.sequenceNo = 1;
    that.messages = [];
    that.timer = null;

    that.currentStripData = [];

    console.log('New controller intialized');

    for (i = 0; i < that.params.pixelpusher.numberStrips; i++) {
        that.currentStripData.push({
            strip_id : i,
            data : new Buffer(0)
        });
    }
};

// build the Controller obj to contain the necessary EventEmitter methods
util.inherits(Controller, Emitter);

Controller.prototype.refresh = function(strips) {
    var i,j, m, n, numbers, offset;
    var packet = null;
    var that = this;

    // Format checking
    // and unchanged strip checking
    var updatedValidStrips = [];

    for (i = 0; i < strips.length; i++) {
        var stripId = strips[i].strip_id;

        // confirm proper strip numbering
        if ((stripId < 0) || (stripId >= that.params.pixelpusher.numberStrips)) {
            throw new Error('strips must be numbered from 0..' + (that.params.pixelpusher.numberStrips-1+' current value ['+n+']'));
        }

        if( !that.currentStripData[i] || that.currentStripData.length == 0) {
            // console.log('Strip #' + stripId + ' empty');
            continue;
        }

        //TODO: Figure out why skipping a row does not work
        // filter out sending dup data
        if (buffertools.equals(strips[i].data, that.currentStripData[i].data)) {
            //console.log('Strip #' + stripId + ' unchanged');
            //continue;
        } else {
            console.log('Strip #' + stripId + ' valid');
        }

        // push the valid strip
        updatedValidStrips.push(strips[i]);
    }

    strips = updatedValidStrips;
    that.currentStripData = strips;

    /*
    // -- PACKET STRUCTURE --
    typedef struct pixel _PACKED_ {
       uint8_t red;
       uint8_t green;
       uint8_t blue;
    } pixel_t;

    // the packet goes like:

    uint32_t sequence_number;  // monotonically ascends, per-pusher.
    while (packet_not_full_up) {
       uint8_t strip_number;
       pixel_t strip_data[NUMBER_OF_PIXELS];  // you must fill at least one entire strip.
    }
    */

    // mark the max number of strips we can send per packet
    var stripsPerPacket = that.params.pixelpusher.stripsPerPkt;

    // we do however need to send all the strip data that was given to us
    // so get the total strips to be sent
    var totalStripsToSend = strips.length;
    // calculate the number of packets this will require
    var packetsToSend = Math.ceil(totalStripsToSend/stripsPerPacket);
    // it takes 4 bytes in the stream to denote the packet sequence number
    var sequenceDenotationLength = 4;
    // then a single byte to say which strip we are talking to
    var stripIdDenotationLength = 1;

    // loop through the strips and fill packets with the strip data
    var stripIdx = 0;
    for (var packetNum = 0; packetNum<packetsToSend; packetNum++){
        // initialize the packet
        packet = null;
        // calculate how many strips will be in this packet.
        // not to exceed 'stripsPerPacket'
        var remaining = totalStripsToSend - stripIdx;
        var stripsInThisPacket = Math.min(stripsPerPacket, remaining);

        // calculate the length of this data
        var totalPixelDataLength = 0;
        for (i = 0; i < stripsInThisPacket; i++) {
            totalPixelDataLength += stripIdDenotationLength + strips[stripIdx+i].data.length;
        }
        // build a buffer of the approiate size
        var packetLength = sequenceDenotationLength + totalPixelDataLength;
        packet = new Buffer(packetLength);
        // initialize the buffer with all 0's
        packet.fill(0x00);

        // use this 'pointerPosition' to run through the buffer
        // setting data as needed
        var pointerPosition = 0;
        // place the message sequence number as the first value
        packet.writeUInt32LE(that.sequenceNo, 0);
        // immeadietly increment it
        // it does not matter where this value starts
        // as long as it is always increacing
        that.sequenceNo++
        // move for the int32
        pointerPosition += 4;

        // loop through each strip and set the strip data into the buffer
        for (i = 0; i < stripsInThisPacket; i++) {
            var strip = strips[stripIdx];
            // mark the strip id
            packet.writeUInt8(strip.strip_id, pointerPosition);
            // move for the int32
            pointerPosition += 1;

            // write the pixel data into the buffer
            for (j = 0; j < strip.data.length; j++) {
                packet[pointerPosition] = strip.data[j]
                pointerPosition++;
            }
            // insure we mark we are moving to the next strip
            stripIdx ++;
        }

        // after a packet is filled push it into the
        // queue fr delivery
        that.messages.push({
            sequenceNo: that.sequenceNo,
            packet: packet
        });
    }

    // if we do not have an outstanding timer waiting to send the next packet
    // then call sync to begin the queue drain.
    if ((that.timer === null) && (that.messages.length > 0)) {
        that.sync(that);
    }
};


Controller.prototype.sync = function(controller) {
    var message, now, packet;

    now = new Date().getTime();
    if (now < controller.nextUpdate) {
        controller.timer = setTimeout(function() {
            controller.sync(controller);
        }, controller.nextUpdate - now);
        return;
    }
    controller.timer = null;

    // remove the first item from the messages queue
    message = controller.messages.shift();
    // get a ref to the packet
    packet = message.packet;
    // send the packet over the socket/port/dest ip
    controller.params.socket.send(packet, 0, packet.length, controller.params.pixelpusher.myPort, controller.params.ipAddress);

    // mark when we need to send the next update
    controller.nextUpdate = now + controller.params.pixelpusher.updatePeriod;

    // if there are no more messages to send then
    // dont re set the drain timeout
    if (controller.messages.length === 0) return;

    // we have more messages so set another time out to drain the queue
    // dont exceed 'updatePeriod'
    controller.timer = setTimeout(function() {
        controller.sync(controller);
    }, controller.params.pixelpusher.updatePeriod);
};

Controller.prototype.trimStaleMessages = function(controller) {
    var f, i, j, messages, numbers, x;

    // if we only have 2 messages which would most likely coorispond to
    // 2 4 strip command then ignore this trip and let the drain timer
    // push these to the strips
    if (controller.messages.length < 2) return;
    // simple trim to the latest 2 packets
    controller.messages = controller.messages.slice(0,2);
};

PixelPusher.PixelStrip = PixelStrip;
PixelPusher.Pixel = Pixel;
module.exports = PixelPusher;

return;

/*
 *  Universal Discovery Protocol
 *  A UDP protocol for finding Etherdream/Heroic Robotics lighting devices
 *
 *  (c) 2012 Jas Strong and Jacob Potter
 *  <jasmine@electronpusher.org> <jacobdp@gmail.com>
 */

/*

#define SFLAG_RGBOW             (1 << 0)
#define SFLAG_WIDEPIXELS        (1 << 1)

#define PFLAG_PROTECTED         (1 << 0)

typedef enum DeviceType { ETHERDREAM = 0, LUMIABRIDGE = 1, PIXELPUSHER = 2 } DeviceType;

typedef struct PixelPusher {
    uint8_t  strips_attached;
    uint8_t  max_strips_per_packet;
    uint16_t pixels_per_strip;          // uint16_t used to make alignment work
    uint32_t update_period;             // in microseconds
    uint32_t power_total;               // in PWM units
    uint32_t delta_sequence;            // difference between received and expected sequence numbers
    int32_t controller_ordinal;         // ordering number for this controller.
    int32_t group_ordinal;              // group number for this controller.
    uint16_t artnet_universe;           // configured artnet starting point for this controller
    uint16_t artnet_channel;
    uint16_t my_port;
    uint8_t strip_flags[8];             // flags for each strip, for up to eight strips
    uint32_t pusher_flags;              // flags for the whole pusher
} PixelPusher;

typedef struct LumiaBridge {
    // placekeeper
} LumiaBridge;

typedef struct EtherDream {
    uint16_t buffer_capacity;
    uint32_t max_point_rate;
    uint8_t light_engine_state;
    uint8_t playback_state;
    uint8_t source;     //   0 = network
    uint16_t light_engine_flags;
    uint16_t playback_flags;
    uint16_t source_flags;
    uint16_t buffer_fullness;
    uint32_t point_rate;                // current point playback rate
    uint32_t point_count;               //  # points played
} EtherDream;

typedef union {
    PixelPusher pixelpusher;
    LumiaBridge lumiabridge;
    EtherDream etherdream;
} Particulars;

typedef struct DiscoveryPacketHeader {
    uint8_t mac_address[6];
    uint8_t ip_address[4];              // network byte order
    uint8_t device_type;
    uint8_t protocol_version;           // for the device, not the discovery
    uint16_t vendor_id;
    uint16_t product_id;
    uint16_t hw_revision;
    uint16_t sw_revision;
    uint32_t link_speed;                // in bits per second
} DiscoveryPacketHeader;

typedef struct DiscoveryPacket {
    DiscoveryPacketHeader header;
    Particulars p;
} DiscoveryPacket;

*/
