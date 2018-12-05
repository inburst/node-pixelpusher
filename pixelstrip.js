
var Pixel = require('./pixel');

module.exports = function(stripId, numPixels) {
    var that = this;
    var pixels = [];


    var STRIP_ID = stripId;
    var NUM_PIXELS = numPixels;

    // init strip
    for (var i = 0; i < NUM_PIXELS; i ++){
        pixels.push(new Pixel());
    }

    this.clear = function() {
        for (var i = 0; i < NUM_PIXELS; i ++){
            pixels[i].setColor(0, 0, 0, 0);
        }
    }

    this.setStripColor = function(r, g, b, a){
        for (var i = 0; i < NUM_PIXELS; i ++){
            pixels[i].setColor(r, g, b, a);
        }
    };

    this.getStripData = function(){
        var strip = {
            strip_id : STRIP_ID,
            data : new Buffer(3 * NUM_PIXELS)
        }
        // fill the buffer with off pixels
        strip.data.fill(0x00);

        for (var i = 0, j = 0; i < NUM_PIXELS; i ++, j+=3){
            var pixelData = pixels[i].toData3();
            strip.data[j + 0] = pixelData[0];
            strip.data[j + 1] = pixelData[1];
            strip.data[j + 2] = pixelData[2];
        }

        return strip;
    }

    this.getRandomPixel = function(){
        var randomIndex = Math.floor(Math.random() * NUM_PIXELS);
        return pixels[randomIndex];
    }

    this.getPixel = function(idx){
        return pixels[idx];
    }
}
