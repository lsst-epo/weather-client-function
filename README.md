# Cloud Function for the Meteoblue API
This cloud function does some logic to get the next hour's weather data from meteoblue for the `basic` endpoint and the `clouds` endpoint.

See [here](https://docs.meteoblue.com/en/weather-apis/forecast-api/overview) for more info on the meteoblue API documentation.

## Notes
API keys need to be refreshed every year.

## Architecture
Planned architecture
```mermaid
graph LR
    subgraph RedisClient
        basic-weather-stats
        cloud-weather-stats
    end


    subgraph meteoblue
        meteoblueapi
    end

    subgraph meteoblueclient
        basic-stats
        cloud-stats
    end

    subgraph Hasura
        precipitationData
        cloudData
    end
    meteoblueapi-->basic-stats
    meteoblueapi-->cloud-stats
    basic-stats-->basic-weather-stats
    cloud-stats-->cloud-weather-stats
    basic-weather-stats-->precipitationData
    cloud-weather-stats-->cloudData
    Hasura-->graphQL
    
```

## Deployment

First, build the typescript:

```
yarn build
```

The above command will create a `/dist` folder with the built Javascript.

Then, ensure your `gcloud` CLI is pointed at the correct GCP project and deploy the cloud function:

```
sh deploy.sh
```