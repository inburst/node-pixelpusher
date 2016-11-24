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
    var UPDATE_FREQUENCY_MILLIS = 30;// 15 is just faster than 60 FPS

    var waveHeight = PIXELS_PER_STRIP/2;
    var waveWidth = 10;
    var wavePosition = 0;


    timer = setInterval(function() {
        // create an array to hold the data for all the strips at once
        // loop
        var strips = [];
        for (var stripId = 0; stripId< NUM_STRIPS; stripId ++){
            var s = new PixelStrip(stripId,PIXELS_PER_STRIP);

            var startIdx = waveHeight+wavePosition;
            for (var i = startIdx, j = waveWidth; i <PIXELS_PER_STRIP &&  i > waveHeight && j > 0; i --, j--){
                // right wave
                var p = s.getPixel(i);
                p.setColor(255,0,0,(j/waveWidth));
            }

            var startIdx = waveHeight-wavePosition;
            for (var i = startIdx, j = waveWidth; i > 0 &&  i < waveHeight && j > 0; i ++, j--){
                // right wave
                var p = s.getPixel(i);
                p.setColor(255,0,0,(j/waveWidth));
            }

            // to show combined systems also set a random pixel blue
            // set a random pixel blue
            s.getRandomPixel().setColor(0,0,255, 0.1);
            // render the strip data into the correct format for sending
            // to the pixel pusher controller
            var renderedStripData = s.getStripData();
            // add this data to our list of strip data to send
            strips.push(renderedStripData);
        }
        // inform the controller of the new strip frame
        controller.refresh(strips);

        wavePosition = (wavePosition + 1) % waveHeight;

    }, UPDATE_FREQUENCY_MILLIS);

}).on('error', function(err) {
  console.log('PixelPusher Error: ' + err.message);
});
