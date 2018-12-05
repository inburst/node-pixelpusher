var PixelPusher = require('../pixelpusher');
var PixelStrip = PixelPusher.PixelStrip;

new PixelPusher().on('discover', function(controller) {
    var timer = null;

    // log connection data on initial discovery
    console.log('-----------------------------------');
    console.log('Discovered PixelPusher on network: ');
    console.log(controller.params.pixelpusher);
    console.log('-----------------------------------');

    // capture the update message sent back from the pp controller
    controller.on('update', function() {
        console.log ({
            updatePeriod  : this.params.pixelpusher.updatePeriod,
            deltaSequence : this.params.pixelpusher.deltaSequence,
            powerTotal    : this.params.pixelpusher.powerTotal
        });
    }).on('timeout', function() {
        // be sure to handel the situation when the controller dissappears.
        // this could be due to power cycle or network conditions
        console.log('TIMEOUT : PixelPusher at address [' + controller.params.ipAddress + '] with MAC (' + controller.params.macAddress + ') has timed out. Awaiting re-discovery....');
        if (!!timer) clearInterval(timer);
    });
    // aquire the number of strips that the controller has said it
    // has connected via the pixel.rc config file
    var NUM_STRIPS = controller.params.pixelpusher.numberStrips;
    var STRIPS_PER_PACKET = controller.params.pixelpusher.stripsPerPkt;
    var NUM_PACKETS_PER_UPDATE = NUM_STRIPS/STRIPS_PER_PACKET;

    // aquire the number of pixels we that the controller reports is
    // in each strip. This is set in the pixel.rc file placed on your thumb drive.
    var PIXELS_PER_STRIP = controller.params.pixelpusher.pixelsPerStrip;

    // create a loop that will send commands to the PP to update the strip
    var UPDATE_FREQUENCY_MILLIS = 30; // 15 is just faster than 60 FPS


    timer = setInterval(function() {
        // create an array to hold the data for all the strips at once
        // loop
        var strips = [];
        for (var i = 0; i < NUM_STRIPS; i ++){
            var stripId = i;
            var s = new PixelStrip(stripId,PIXELS_PER_STRIP);

            // this sets random pixels on for each strip
            // it also does a different color for wach of the 4 strips
            /*
            if (i == 0 || i == 4){
                s.getRandomPixel().setColor(255,0,0, 0.1);
            } else if (i == 1 || i == 5){
                s.getRandomPixel().setColor(0,255,0, 0.1);
            } else if (i == 2 || i == 6){
                s.getRandomPixel().setColor(0,0,255, 0.1);
            } else if (i == 3 || i == 7){
                s.getRandomPixel().setColor(100,0,55, 0.1);
            }
            */

            s.getRandomPixel().setColor(255,0,0, 0.1);
            // set the whole strip blue

            // render the strip data into the correct format for sending
            // to the pixel pusher controller
            var renderedStripData = s.getStripData();
            // add this data to our list of strip data to send
            strips.push(renderedStripData);
        }

        //console.log(strips.length)

        // inform the controller of the new strip frame
        controller.refresh(strips);

    }, UPDATE_FREQUENCY_MILLIS);
}).on('error', function(err) {
  console.log('PixelPusher Error: ' + err.message);
});
