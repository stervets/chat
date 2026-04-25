export default {
  props: {
    copiedDonationPhone: Boolean,
    donationActionError: {type: String, default: ''},
    donationBank: {type: String, default: ''},
    donationButtonText: {type: String, default: ''},
    donationButtonUndoMode: Boolean,
    donationPhone: {type: String, default: ''},
    vpnInfoError: {type: String, default: ''},
    vpnInfoLoading: Boolean,
  },

  emits: [
    'copy-donation-phone',
    'donation-button-click',
  ],

  methods: {
    copyDonationPhone(this: any) {
      this.$emit('copy-donation-phone');
    },

    onDonationButtonClick(this: any) {
      this.$emit('donation-button-click');
    },
  },
};
