document.getElementById('connect-btn').addEventListener('click', connectToArduino);

let serialPort;
let reader;
let decoder;
let dataTable = document.getElementById('data-table').getElementsByTagName('tbody')[0];
let dataset = [];  // Array to store data from Arduino
let receivedData = '';  // Buffer to accumulate incoming data

// Create a chart instance for MQ2 data
let mq2Data = [];
let tempData = [];
let humidityData = [];
let timestamps = [];

// Create a Chart.js instance for the MQ2 graph
const ctxMQ2 = document.getElementById('mq2-chart').getContext('2d');
const mq2Chart = new Chart(ctxMQ2, {
  type: 'line',
  data: {
    labels: timestamps,
    datasets: [{
      label: 'MQ2 Sensor Value',
      data: mq2Data,
      borderColor: 'rgba(0, 123, 255, 0.7)',
      fill: false,
    }]
  },
  options: {
    responsive: true,
    scales: {
      x: {
        type: 'linear',
        position: 'bottom',
        title: {
          display: true,
          text: 'Time (in seconds)'
        }
      },
      y: {
        title: {
          display: true,
          text: 'MQ2 Value'
        }
      }
    }
  }
});

// Create a Chart.js instance for the Temperature and Humidity graph
const ctxTempHumidity = document.getElementById('temp-humidity-chart').getContext('2d');
const tempHumidityChart = new Chart(ctxTempHumidity, {
  type: 'line',
  data: {
    labels: timestamps,
    datasets: [{
      label: 'Temperature (°C)',
      data: tempData,
      borderColor: 'rgba(255, 99, 132, 0.7)',
      fill: false,
    }, {
      label: 'Humidity (%)',
      data: humidityData,
      borderColor: 'rgba(75, 192, 192, 0.7)',
      fill: false,
    }]
  },
  options: {
    responsive: true,
    scales: {
      x: {
        type: 'linear',
        position: 'bottom',
        title: {
          display: true,
          text: 'Time (in seconds)'
        }
      },
      y: {
        title: {
          display: true,
          text: 'Values'
        }
      }
    }
  }
});

async function connectToArduino() {
  try {
    // Request a port and open the connection
    serialPort = await navigator.serial.requestPort();  // This opens a dialog to choose a device
    console.log('Serial port requested.');

    await serialPort.open({ baudRate: 9600 });  // Open the serial port with the correct baud rate
    console.log('Serial port opened.');

    decoder = new TextDecoderStream();
    const readableStreamClosed = serialPort.readable.pipeTo(decoder.writable);
    reader = decoder.readable.getReader();

    readData();  // Start reading data once the connection is open
  } catch (err) {
    console.error('There was an error connecting to the Arduino:', err);
    alert('Failed to connect to Arduino. Please ensure your Arduino is connected and try again.');
  }
}


async function readData() {
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      receivedData += value;

      let messageEndIndex = receivedData.indexOf('\n');

      while (messageEndIndex !== -1) {
        let completeMessage = receivedData.slice(0, messageEndIndex).trim();

        // Check for the "EMERGENCY" message first
        if (completeMessage.includes('EMERGENCY: Immediate assistance required!')) {
          let emergencyMessage = completeMessage.replace('EMERGENCY: ', '');
          let timestamp = new Date().toLocaleTimeString();
          updatePanicAction(true, emergencyMessage, timestamp);
        } else {
          // Process normal data if it's not an emergency message
          let tempMatch = completeMessage.match(/Temp:([\d.]+)C/);
          let humidityMatch = completeMessage.match(/Humidity:([\d.]+)%/);
          let mq2Match = completeMessage.match(/MQ2:(\d+)/);
          let stabilityMatch = completeMessage.match(/Stability:(\w+)/);
          let gpsMatch = completeMessage.match(/GPS:([\d.-]+)° N, ([\d.-]+)° E/); // Regex to extract GPS

          if (tempMatch && humidityMatch && mq2Match && stabilityMatch && gpsMatch) {
            let temperature = tempMatch[1];
            let humidity = humidityMatch[1];
            let mq2Value = mq2Match[1];
            let stability = stabilityMatch[1];
            let latitude = gpsMatch[1];
            let longitude = gpsMatch[2];

            // Log the GPS data for debugging
            console.log("Extracted GPS - Latitude:", latitude, "Longitude:", longitude);

            let newData = {
              timestamp: new Date().toLocaleTimeString(),
              temperature: temperature,
              humidity: humidity,
              mq2: mq2Value,
              stability: stability,
              latitude: latitude,
              longitude: longitude
            };

            dataset.push(newData);

            updateTable(newData);
            updateGraph(mq2Value, temperature, humidity);
            updatePanicAction(false);  // Reset panic status when no emergency message
            updateLocation(latitude, longitude); // Update location on the website

            // Send email with GPS data if it's an emergency
            updatePanicAction(false); // You can send an email only when there's an emergency
            sendEmail(latitude, longitude); // Send email with coordinates
          }
        }

        receivedData = receivedData.slice(messageEndIndex + 1);
        messageEndIndex = receivedData.indexOf('\n');
      }
    }
  } catch (err) {
    console.error('Error reading data:', err);
  }
}

function updateTable(data) {
  // Add a new row to the table
  let row = dataTable.insertRow(0);
  let timestampCell = row.insertCell(0);
  let temperatureCell = row.insertCell(1);
  let humidityCell = row.insertCell(2);
  let mq2Cell = row.insertCell(3);
  let stabilityCell = row.insertCell(4);

  timestampCell.textContent = data.timestamp;
  temperatureCell.textContent = data.temperature + '°C';
  humidityCell.textContent = data.humidity + '%';
  mq2Cell.textContent = data.mq2;
  stabilityCell.textContent = data.stability;

  // Highlight "Movement Detected" in red
  if (data.stability === 'Movement Detected') {
    stabilityCell.style.color = 'red';
  } else {
    stabilityCell.style.color = '';
  }
}

function updateGraph(mq2Value, temperature, humidity) {
  let currentTime = timestamps.length + 1;

  timestamps.push(currentTime);
  mq2Data.push(mq2Value);
  tempData.push(temperature);
  humidityData.push(humidity);

  mq2Chart.update();
  tempHumidityChart.update();
}

let currentEmergencyMessage = ''; // Store the current emergency message

function updatePanicAction(isEmergency, message = '', timestamp = '', latitude = '', longitude = '') {
  const panicStatus = document.getElementById('panic-status');

  if (isEmergency) {
    if (currentEmergencyMessage !== message) {
      currentEmergencyMessage = message; // Update the emergency message if it's new
      panicStatus.textContent = `EMERGENCY: ${message} at ${timestamp}`;
      panicStatus.classList.add('red'); // Add the red background class

      // Send email about the emergency
      sendEmail(latitude, longitude);
    }
  } else {
    // Reset panic status if no emergency
    if (currentEmergencyMessage !== '') {
      panicStatus.textContent = `Stable`;
      panicStatus.classList.remove('red'); // Remove the red background
      currentEmergencyMessage = ''; // Reset the emergency message when stable
    }
  }
}

// Function to send an email using EmailJS
function sendEmail(latitude, longitude) {
  // Ensure coordinates are not empty
  if (latitude && longitude) {
    const emailData = {
      to_email: 'hkbkece43@gmail.com', // Your email address
      subject: 'Emergency Alert',
      message: `There is an emergency at the location: Latitude: ${latitude}, Longitude: ${longitude}`,
    };

    // Initialize EmailJS
    emailjs.send('service_dzisbfu', 'template_sijnccq', emailData, '3sg5BG5Y6wMgonZUV')
      .then((response) => {
        console.log('Email sent successfully:', response);
      }, (error) => {
        console.error('Error sending email:', error);
      });
  } else {
    console.error("Invalid coordinates, cannot send email.");
  }
}

function updateLocation(latitude, longitude) {
  console.log("Updating location - Latitude:", latitude, "Longitude:", longitude); // Log the coordinates
  document.getElementById('latitude-value').textContent = latitude + '° N';
  document.getElementById('longitude-value').textContent = longitude + '° E';
}
