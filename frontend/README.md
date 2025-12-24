# R49 File Editor

- `https://iot49.org`
- open .jpg (or .r49) file
- calibrate:
  - align rectangle to known dimensions in layout
  - enter width and height (mm) (gear icon upper right)
  - set scale
- markers
  - ?: detector location
  - others are track, train, train-end, train-coupling for labeling
  - delete
- **save**:
  - don't forget to save (.r49 file in ~/Downloads)


## Operation

The intended operation is for the device (typically a smartphone) installed in a fixed location above the layout continuously capturing images and reporting the presence of trains.

This requires a backend server running on a host device. The client (smartphone) connects to the backend via a secure websocket connection.

The server stores the layout description (.r49 file) for the setup.

The client has different modes of operation:

1) Live - continuously captures images and reports the presence of trains (for the markers of the first image in the manifest) to the server which makes this information available for use in other applications (e.g. jmri).
2) Configure - create and edit the layout description (aquire images, calibrate, add and edit markers).
3) Demo - used when no backend is available. In this case, the client loads a sample layout description (from `sample.r49`). The user can discard the sample and create their own from images captured with the camera or uploaded.
