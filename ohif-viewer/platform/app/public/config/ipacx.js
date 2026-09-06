/** @type {AppTypes.Config} */
window.config = {
  routerBasename: '/viewer',
  showStudyList: true,
  extensions: [],
  modes: ['@ohif/mode-longitudinal', '@ohif/mode-basic-dev-mode'],
  showWarningMessageForCrossOrigin: true,
  showCPUFallbackMessage: true,
  showLoadingIndicator: true,
  strictZSpacingForVolumeViewport: true,
  defaultDataSourceName: 'dicomweb',
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        friendlyName: 'iPacx Orthanc',
        name: 'Orthanc',
        wadoUriRoot: '/pacs/wado',
        qidoRoot: '/pacs/dicom-web',
        wadoRoot: '/pacs/dicom-web',
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        dicomUploadEnabled: true,
        omitQuotationForMultipartRequest: true,
        bulkDataURI: {
          enabled: false,
        },
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dcm4chee',
      configuration: {
        friendlyName: 'DCM4CHEE PACS',
        name: 'DCM4CHEE',
        wadoUriRoot: '/dcm4chee/wado',
        qidoRoot: '/dcm4chee/dicom-web',
        wadoRoot: '/dcm4chee/dicom-web',
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        dicomUploadEnabled: false,
        omitQuotationForMultipartRequest: true,
        bulkDataURI: {
          enabled: true,
        },
      },
    },
  ],
  httpErrorHandler: error => {
    console.warn(`HTTP Error Handler (status: ${error.status})`, error);
  },
  whiteLabeling: {
    name: 'iPacx',
    title: 'iPacx',
    createLogoComponentFn: function (React) {
      return React.createElement(
        'a',
        {
          target: '_self',
          rel: 'noopener noreferrer',
          className: 'flex items-center no-underline text-white',
          href: '/',
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            textDecoration: 'none',
            color: 'white',
          },
        },
        React.createElement(
          'span',
          {
            style: {
              fontSize: '24px',
              fontWeight: '700',
              letterSpacing: '-0.02em',
            },
          },
          'iPacx'
        )
      );
    },
  },
  investigationalUseDialog: {
    dontShow: true,
  },
};
